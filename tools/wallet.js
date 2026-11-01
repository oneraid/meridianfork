import {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  VersionedTransaction,
  Keypair,
} from "@solana/web3.js";
import bs58 from "bs58";
import { log } from "../logger.js";
import { config } from "../config.js";
import { getConnection } from "./rpc.js";

let _wallet = null;
let _lastKnownSolPrice = 125;

export function getLastKnownSolPrice() {
  return _lastKnownSolPrice > 0 ? _lastKnownSolPrice : 95.75;
}

function getWallet() {
  if (!_wallet) {
    if (!process.env.WALLET_PRIVATE_KEY) throw new Error("WALLET_PRIVATE_KEY not set");
    _wallet = Keypair.fromSecretKey(bs58.decode(process.env.WALLET_PRIVATE_KEY));
  }
  return _wallet;
}

const SOL_MINT = "So11111111111111111111111111111111111111112";
const JUPITER_PRICE_API = "https://api.jup.ag/price/v3";
const JUPITER_SWAP_V2_API = "https://api.jup.ag/swap/v2";
const DEFAULT_JUPITER_API_KEY = "b15d42e9-e0e4-4f90-a424-ae41ceeaa382";

function getJupiterApiKey() {
  return config.jupiter.apiKey || process.env.JUPITER_API_KEY || DEFAULT_JUPITER_API_KEY;
}

function getJupiterReferralParams() {
  const referralAccount = String(config.jupiter.referralAccount || "").trim();
  const referralFee = Number(config.jupiter.referralFeeBps || 0);
  if (!referralAccount || !Number.isFinite(referralFee) || referralFee <= 0) {
    return null;
  }
  if (referralFee < 50 || referralFee > 255) {
    log("swap_warn", `Ignoring Jupiter referral fee ${referralFee}; Ultra requires 50-255 bps`);
    return null;
  }
  try {
    new PublicKey(referralAccount);
  } catch {
    log("swap_warn", "Ignoring invalid Jupiter referral account");
    return null;
  }
  return { referralAccount, referralFee: Math.round(referralFee) };
}

async function getWalletBalancesFromRpc(walletAddress) {
  try {
    const connection = getConnection();
    const pubkey = new PublicKey(walletAddress);
    const balanceLamports = await connection.getBalance(pubkey);
    const solBalance = balanceLamports / LAMPORTS_PER_SOL;

    // Get parsed token accounts (standard SPL Token and Token-2022)
    let usdcBalance = 0;
    const tokens = [];
    try {
      const [tokenAccounts, token2022Accounts] = await Promise.all([
        connection.getParsedTokenAccountsByOwner(pubkey, {
          programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
        }).catch(() => ({ value: [] })),
        connection.getParsedTokenAccountsByOwner(pubkey, {
          programId: new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"),
        }).catch(() => ({ value: [] })),
      ]);

      const allAccounts = [
        ...(tokenAccounts?.value || []),
        ...(token2022Accounts?.value || []),
      ];

      for (const item of allAccounts) {
        const info = item.account?.data?.parsed?.info;
        const mint = info?.mint;
        const amount = info?.tokenAmount?.uiAmount || 0;
        if (amount > 0 && mint) {
          if (mint === config.tokens.USDC) {
            usdcBalance = amount;
          }
          tokens.push({
            mint,
            symbol: mint === config.tokens.USDC ? "USDC" : mint.slice(0, 8),
            balance: amount,
            usd: mint === config.tokens.USDC ? amount : null,
          });
        }
      }
    } catch (e) {
      log("wallet_warn", `Failed to parse SPL token accounts: ${e.message}`);
    }

    // Get SOL & token prices from Jupiter Price API
    let solPrice = 0;
    try {
      const mintsToPrice = [
        SOL_MINT,
        ...tokens.filter((t) => t.mint !== config.tokens.USDC && t.mint !== SOL_MINT).map((t) => t.mint),
      ];
      const jupiterApiKey = getJupiterApiKey();
      const priceRes = await fetch(`${JUPITER_PRICE_API}?ids=${mintsToPrice.slice(0, 50).join(",")}`, {
        headers: jupiterApiKey ? { "x-api-key": jupiterApiKey } : {},
      });
      if (priceRes.ok) {
        const priceData = await priceRes.json();
        const getPrice = (entry) => Number(entry?.usdPrice ?? entry?.price ?? entry?.data?.price ?? 0);
        const fetchedSolPrice = getPrice(priceData[SOL_MINT] || priceData.data?.[SOL_MINT]);
        if (fetchedSolPrice > 0) {
          solPrice = fetchedSolPrice;
          _lastKnownSolPrice = solPrice;
        }
        for (const token of tokens) {
          if (token.mint === config.tokens.USDC) continue;
          const p = getPrice(priceData[token.mint] || priceData.data?.[token.mint]);
          if (p > 0) {
            token.usd = Math.round(token.balance * p * 100) / 100;
          }
        }
      }
    } catch (e) {
      log("wallet_warn", `Failed to fetch prices from Jupiter: ${e.message}`);
    }

    if (!solPrice || solPrice <= 0) {
      // Fallback 1: DexScreener
      try {
        const dsRes = await fetch("https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112", {
          signal: AbortSignal.timeout(3000),
        });
        if (dsRes.ok) {
          const dsData = await dsRes.json();
          const p = parseFloat(dsData?.pairs?.[0]?.priceUsd || 0);
          if (p > 0) {
            solPrice = p;
            _lastKnownSolPrice = solPrice;
          }
        }
      } catch {}
      // Fallback 2: Cached last known price
      if (!solPrice || solPrice <= 0) {
        solPrice = _lastKnownSolPrice;
      }
    }

    const solUsd = solBalance * solPrice;
    const tokensUsd = tokens.reduce((acc, t) => acc + (t.usd || 0), 0);
    const totalUsd = solUsd + usdcBalance + tokensUsd;

    return {
      wallet: walletAddress,
      sol: Math.round(solBalance * 1e6) / 1e6,
      sol_price: Math.round(solPrice * 100) / 100,
      sol_usd: Math.round(solUsd * 100) / 100,
      usdc: Math.round(usdcBalance * 100) / 100,
      tokens,
      total_usd: Math.round(totalUsd * 100) / 100,
    };
  } catch (err) {
    log("wallet_error", `RPC balance lookup failed: ${err.message}`);
    return {
      wallet: walletAddress,
      sol: 0,
      sol_price: 0,
      sol_usd: 0,
      usdc: 0,
      tokens: [],
      total_usd: 0,
      error: err.message,
    };
  }
}

export async function getWalletBalances() {
  let walletAddress;
  try {
    walletAddress = getWallet().publicKey.toString();
  } catch {
    return { wallet: null, sol: 0, sol_price: 0, sol_usd: 0, usdc: 0, tokens: [], total_usd: 0, error: "Wallet not configured" };
  }

  // 1. Prioritize Free Solana Public RPC first to save 100% of Helius free-tier credits
  try {
    const rpcResult = await getWalletBalancesFromRpc(walletAddress);
    if (rpcResult && rpcResult.wallet) {
      return rpcResult;
    }
  } catch (rpcErr) {
    log("wallet_warn", `Public RPC balance fetch failed (${rpcErr.message.slice(0, 80)}). Falling back to Helius/Alchemy...`);
  }

  // 2. Fallback to Helius REST API if Public Solana RPC is cooling down or failed
  // Track Helius key status to auto-skip exhausted or cooling-down keys
  if (!globalThis._heliusWalletKeyStatus) {
    globalThis._heliusWalletKeyStatus = new Map();
  }
  const keyStatus = globalThis._heliusWalletKeyStatus;

  // Build candidate Helius keys (primary + backups)
  const heliusKeys = [];
  if (process.env.HELIUS_API_KEY) heliusKeys.push(process.env.HELIUS_API_KEY.trim());
  if (process.env.HELIUS_BACKUP_KEYS) {
    process.env.HELIUS_BACKUP_KEYS.split(",").map(k => k.trim()).filter(Boolean).forEach(k => {
      if (!heliusKeys.includes(k)) heliusKeys.push(k);
    });
  }

  const now = Date.now();
  // Filter candidate keys: prioritize those not exhausted and not currently cooling down
  const nonExhaustedKeys = heliusKeys.filter(k => {
    const s = keyStatus.get(k);
    if (!s) return true;
    return s.cooldownUntil <= now;
  });

  const keysToTry = nonExhaustedKeys.length > 0 ? nonExhaustedKeys : heliusKeys;

  for (const key of keysToTry) {
    try {
      const url = `https://api.helius.xyz/v1/wallet/${walletAddress}/balances?api-key=${key}`;
      const res = await fetch(url);
      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        const isExhausted =
          errorText.includes("max usage reached") ||
          errorText.includes("quota exceeded") ||
          errorText.includes("credits exhausted");
        keyStatus.set(key, {
          isExhausted,
          cooldownUntil: now + (isExhausted ? 12 * 3600 * 1000 : 2 * 60 * 1000),
        });
        throw new Error(`Helius API error: ${res.status} ${errorText || res.statusText}`);
      }

      // Success: clear any failure status
      keyStatus.delete(key);

      const data = await res.json();
      const balances = data.balances || [];

      // ─── Find SOL and USDC ────────────────────────────────────
      const solEntry = balances.find(b => b.mint === config.tokens.SOL || b.symbol === "SOL");
      const usdcEntry = balances.find(b => b.mint === config.tokens.USDC || b.symbol === "USDC");

      const solBalance = solEntry?.balance || 0;
      const solPrice = solEntry?.pricePerToken || 0;
      const solUsd = solEntry?.usdValue || 0;
      const usdcBalance = usdcEntry?.balance || 0;

      // ─── Map all tokens ───────────────────────────────────────
      const enrichedTokens = balances.map(b => ({
        mint: b.mint,
        symbol: b.symbol || b.mint.slice(0, 8),
        balance: b.balance,
        usd: b.usdValue ? Math.round(b.usdValue * 100) / 100 : null,
      }));

      return {
        wallet: walletAddress,
        sol: Math.round(solBalance * 1e6) / 1e6,
        sol_price: Math.round(solPrice * 100) / 100,
        sol_usd: Math.round(solUsd * 100) / 100,
        usdc: Math.round(usdcBalance * 100) / 100,
        tokens: enrichedTokens,
        total_usd: Math.round((data.totalUsdValue || 0) * 100) / 100,
      };
    } catch (error) {
      log("wallet_warn", `Helius balance fetch with key ${key.slice(0, 6)}... failed (${error.message.slice(0, 80)}). Trying next...`);
    }
  }

  // Fallback to Solana RPC / Alchemy connection if all Helius keys fail
  log("wallet_warn", "All Helius API keys failed or rate-limited. Falling back to Solana RPC / Alchemy balance lookup...");
  return await getWalletBalancesFromRpc(walletAddress);
}

/**
 * Swap tokens via Jupiter Swap API V2 (order → sign → execute).
 */

// Normalize any SOL-like address to the correct wrapped SOL mint
export function normalizeMint(mint) {
  if (!mint) return mint;
  if (
    mint === "SOL" || 
    mint === "native" || 
    /^So1+$/.test(mint) || 
    (mint.length >= 32 && mint.length <= 44 && mint.startsWith("So1") && mint !== SOL_MINT)
  ) {
    return SOL_MINT;
  }
  return mint;
}

export async function getOnChainTokenBalance(mint, walletAddress = null) {
  const wallet = getWallet();
  const pubkey = walletAddress ? new PublicKey(walletAddress) : wallet.publicKey;
  const connection = getConnection();
  const normalized = normalizeMint(mint);

  if (normalized === config.tokens.SOL || normalized === SOL_MINT) {
    const lamports = await connection.getBalance(pubkey);
    return {
      mint: config.tokens.SOL,
      symbol: "SOL",
      balance: lamports / LAMPORTS_PER_SOL,
      raw_amount: lamports.toString(),
      decimals: 9,
      found: true,
    };
  }

  const [tokenAccounts, token2022Accounts] = await Promise.all([
    connection.getParsedTokenAccountsByOwner(pubkey, {
      programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    }).catch(() => ({ value: [] })),
    connection.getParsedTokenAccountsByOwner(pubkey, {
      programId: new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"),
    }).catch(() => ({ value: [] })),
  ]);

  const allAccounts = [
    ...(tokenAccounts?.value || []),
    ...(token2022Accounts?.value || []),
  ];

  let rawTotal = 0n;
  let decimals = 9;
  let uiTotal = 0;
  let found = false;

  for (const item of allAccounts) {
    const info = item.account?.data?.parsed?.info;
    if (info?.mint === normalized) {
      found = true;
      const raw = BigInt(info.tokenAmount?.amount || "0");
      rawTotal += raw;
      decimals = info.tokenAmount?.decimals ?? decimals;
      uiTotal += Number(info.tokenAmount?.uiAmount || 0);
    }
  }

  return {
    mint: normalized,
    balance: uiTotal,
    raw_amount: rawTotal.toString(),
    decimals,
    found,
  };
}

export async function getNonSolTokensWithBalance(walletAddress = null) {
  const wallet = getWallet();
  const pubkey = walletAddress ? new PublicKey(walletAddress) : wallet.publicKey;
  const connection = getConnection();

  const [tokenAccounts, token2022Accounts] = await Promise.all([
    connection.getParsedTokenAccountsByOwner(pubkey, {
      programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    }).catch(() => ({ value: [] })),
    connection.getParsedTokenAccountsByOwner(pubkey, {
      programId: new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"),
    }).catch(() => ({ value: [] })),
  ]);

  const allAccounts = [
    ...(tokenAccounts?.value || []),
    ...(token2022Accounts?.value || []),
  ];

  const tokenMap = new Map();

  for (const item of allAccounts) {
    const info = item.account?.data?.parsed?.info;
    const mint = info?.mint;
    if (!mint || mint === config.tokens.SOL || mint === SOL_MINT) continue;

    const raw = BigInt(info.tokenAmount?.amount || "0");
    const ui = Number(info.tokenAmount?.uiAmount || 0);
    const decimals = info.tokenAmount?.decimals ?? 9;

    if (raw > 0n && ui > 0) {
      if (tokenMap.has(mint)) {
        const existing = tokenMap.get(mint);
        existing.rawTotal += raw;
        existing.balance += ui;
      } else {
        tokenMap.set(mint, {
          mint,
          rawTotal: raw,
          balance: ui,
          decimals,
        });
      }
    }
  }

  return Array.from(tokenMap.values()).map((t) => ({
    mint: t.mint,
    raw_amount: t.rawTotal.toString(),
    balance: t.balance,
    decimals: t.decimals,
  }));
}

export async function swapToken({
  input_mint,
  output_mint,
  amount,
  raw_amount,
  slippage_bps,
}) {
  input_mint  = normalizeMint(input_mint);
  output_mint = normalizeMint(output_mint);

  if (process.env.DRY_RUN === "true") {
    return {
      dry_run: true,
      would_swap: { input_mint, output_mint, amount, raw_amount, slippage_bps },
      message: "DRY RUN — no transaction sent",
    };
  }

  try {
    const wallet = getWallet();
    const connection = getConnection();

    // ─── Convert to smallest unit ──────────────────────────────
    let amountStr;
    if (raw_amount != null && String(raw_amount).trim() !== "" && String(raw_amount) !== "0") {
      amountStr = String(raw_amount).trim();
    } else {
      let decimals = 9; // SOL default
      if (input_mint !== config.tokens.SOL) {
        const mintInfo = await connection.getParsedAccountInfo(new PublicKey(input_mint));
        decimals = mintInfo.value?.data?.parsed?.info?.decimals ?? 9;
      }
      amountStr = Math.floor(amount * Math.pow(10, decimals)).toString();
    }

    if (!amountStr || amountStr === "0") {
      return { success: false, error: "Swap amount is zero" };
    }

    log("swap", `${amount ?? amountStr} of ${input_mint} → ${output_mint}`);

    // ─── Get Swap V2 order (unsigned tx + requestId) ───────────
    const search = new URLSearchParams({
      inputMint: input_mint,
      outputMint: output_mint,
      amount: amountStr,
      taker: wallet.publicKey.toString(),
    });
    if (slippage_bps != null && Number.isFinite(Number(slippage_bps))) {
      search.set("slippageBps", String(Math.round(Number(slippage_bps))));
    }
    const referralParams = getJupiterReferralParams();
    if (referralParams) {
      search.set("referralAccount", referralParams.referralAccount);
      search.set("referralFee", String(referralParams.referralFee));
    }
    const orderUrl = `${JUPITER_SWAP_V2_API}/order?${search.toString()}`;
    const jupiterApiKey = getJupiterApiKey();

    const orderRes = await fetch(orderUrl, {
      headers: jupiterApiKey ? { "x-api-key": jupiterApiKey } : {},
    });
    if (!orderRes.ok) {
      const body = await orderRes.text();
      throw new Error(`Swap V2 order failed: ${orderRes.status} ${body}`);
    }

    const order = await orderRes.json();
    if (order.errorCode || order.errorMessage) {
      throw new Error(`Swap V2 order error: ${order.errorMessage || order.errorCode}`);
    }

    const { transaction: unsignedTx, requestId } = order;

    // ─── Deserialize and sign ─────────────────────────────────
    const tx = VersionedTransaction.deserialize(Buffer.from(unsignedTx, "base64"));
    tx.sign([wallet]);
    const signedTx = Buffer.from(tx.serialize()).toString("base64");

    // ─── Execute ───────────────────────────────────────────────
    const execRes = await fetch(`${JUPITER_SWAP_V2_API}/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(jupiterApiKey ? { "x-api-key": jupiterApiKey } : {}),
      },
      body: JSON.stringify({ signedTransaction: signedTx, requestId }),
    });
    if (!execRes.ok) {
      throw new Error(`Swap V2 execute failed: ${execRes.status} ${await execRes.text()}`);
    }

    const result = await execRes.json();
    if (result.status === "Failed") {
      throw new Error(`Swap failed on-chain: code=${result.code}`);
    }

    log("swap", `SUCCESS tx: ${result.signature}`);
    if (referralParams && order.feeBps !== referralParams.referralFee) {
      log(
        "swap_warn",
        `Jupiter referral fee requested ${referralParams.referralFee} bps but order applied ${order.feeBps ?? "unknown"} bps`,
      );
    }

    return {
      success: true,
      tx: result.signature,
      input_mint,
      output_mint,
      amount_in: result.inputAmountResult,
      amount_out: result.outputAmountResult,
      referral_account: referralParams?.referralAccount || null,
      referral_fee_bps_requested: referralParams?.referralFee || 0,
      fee_bps_applied: order.feeBps ?? null,
      fee_mint: order.feeMint ?? null,
    };
  } catch (error) {
    log("swap_error", error.message);
    return { success: false, error: error.message };
  }
}
