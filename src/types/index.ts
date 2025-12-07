import { VersionedTransaction } from '@solana/web3.js';

// Token types
export const TOKEN_ADDRESS = {
  SOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  JUP: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
} as const;

export type TokenTicker = keyof typeof TOKEN_ADDRESS;

// Jito endpoints
export const JITO_ENDPOINTS = {
  MAINNET: 'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
  NY: 'https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles',
  AMSTERDAM: 'https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles',
  FRANKFURT: 'https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles',
  TOKYO: 'https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles',
} as const;

// Drift constants
export const DRIFT_SPOT_MARKETS = {
  USDC: 0, // QUOTE_SPOT_MARKET_INDEX
  SOL: 1,
} as const;

// Transaction building result
export interface TransactionBuildResult {
  transaction: VersionedTransaction;
  description: string;
}

// Jupiter types
export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
  routePlan: any[];
}

export interface JupiterSwapParams {
  inputToken: TokenTicker;
  outputToken: TokenTicker;
  amount: number;
  slippageBps?: number;
}

// Drift types
export interface DriftDepositParams {
  usdcAmount: number; // Amount of USDC to deposit as collateral
  subAccountId?: number;
}

export interface DriftShortParams {
  marketName: string;
  baseAssetAmount: number;
  subAccountId?: number;
  depositAmount?: number; // Optional USDC deposit before opening position
}

// Transfer types
export interface TokenTransferParams {
  token: TokenTicker;
  recipient: string;
  amount: number;
}

// Jito bundle types
export interface JitoBundleParams {
  transactions: VersionedTransaction[];
  tipLamports?: number;
}

export interface JitoBundleResult {
  bundleId: string;
  success: boolean;
  error?: string;
}

export interface BundleStatus {
  bundle_id: string;
  transactions: string[];
  slot: number;
  confirmation_status: string;
  err: any;
}

// Sequential operation config (replaces atomic Jito bundle)
export interface AtomicOperationConfig {
  solAmount: number;
  shortAmount: number;
  transferAmount: number;
  targetAddress: string;
  depositAmount?: number; // USDC to deposit to Drift before shorting
  slippageBps?: number;
}

// Hook states
export type OperationStatus = 'idle' | 'loading' | 'success' | 'error';

export interface OperationState<T = any> {
  status: OperationStatus;
  data?: T;
  error?: string;
}

// Re-export sequential execution types
export type {
  TransactionExecutionStatus,
  TransactionProgress,
  SequentialExecutionResult,
  TransactionToBuild,
} from '../utils/sequential-executor';
