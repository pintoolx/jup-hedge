import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import { createJupiterApiClient, QuoteResponse } from '@jup-ag/api';
import { TOKEN_ADDRESS, TokenTicker } from '../types';

// Constants for minimum JUP output
const MINIMUM_JUP_OUTPUT = 250;
const BUFFER_PERCENTAGE = 1.05; // 5% buffer

// Token mint addresses for price API
const JUP_MINT = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

/**
 * Jupiter Price API response type
 */
interface JupiterPriceData {
  usdPrice: number;
  blockId: number;
  decimals: number;
  priceChange24h: number;
}

/**
 * Fetch JUP and SOL prices from Jupiter Price API v3
 * @returns Object containing JUP and SOL prices in USD
 */
export async function getJupiterPrices(): Promise<{ jupPrice: number; solPrice: number }> {
  const options = {
    method: 'GET',
    headers: { 'x-api-key': import.meta.env.VITE_JUPITER_API_KEY || '' }
  };

  const response = await fetch(
    `https://api.jup.ag/price/v3?ids=${JUP_MINT},${SOL_MINT}`,
    options
  );

  if (!response.ok) {
    throw new Error(`Jupiter Price API error: ${response.status}`);
  }

  const data: Record<string, JupiterPriceData> = await response.json();

  if (!data[JUP_MINT] || !data[SOL_MINT]) {
    throw new Error('Missing price data from Jupiter API');
  }

  return {
    jupPrice: data[JUP_MINT].usdPrice,
    solPrice: data[SOL_MINT].usdPrice,
  };
}

/**
 * Calculate required SOL amount to receive minimum 250 JUP
 * Includes 5% buffer to ensure at least 250 JUP is received
 * @returns Object containing calculated SOL amount and price info
 */
export async function calculateRequiredSolForMinimumJup(): Promise<{
  solAmount: number;
  jupPrice: number;
  solPrice: number;
  targetJupAmount: number;
  minimumJupOutput: number;
}> {
  const { jupPrice, solPrice } = await getJupiterPrices();
  const targetJupAmount = MINIMUM_JUP_OUTPUT * BUFFER_PERCENTAGE; // 262.5 JUP

  // Calculate: targetJupAmount JUP * jupPriceUSD = X USD
  // X USD / solPriceUSD = requiredSol
  const requiredSol = (targetJupAmount * jupPrice) / solPrice;

  return {
    solAmount: requiredSol,
    jupPrice,
    solPrice,
    targetJupAmount,
    minimumJupOutput: MINIMUM_JUP_OUTPUT,
  };
}

/**
 * Get token decimals (hardcoded for known tokens)
 */
export function getTokenDecimals(token: TokenTicker): number {
  const decimals: Record<TokenTicker, number> = {
    SOL: 9,
    USDC: 6,
    JUP: 6,
  };
  return decimals[token] ?? 9;
}

/**
 * Convert human amount to lamports/base units
 */
export function toBaseUnits(amount: number, token: TokenTicker): number {
  const decimals = getTokenDecimals(token);
  return Math.floor(amount * Math.pow(10, decimals));
}

/**
 * Convert base units to human readable amount
 */
export function fromBaseUnits(amount: string | number, token: TokenTicker): number {
  const decimals = getTokenDecimals(token);
  return Number(amount) / Math.pow(10, decimals);
}

/**
 * Jupiter API client instance (lazy initialized)
 */
let jupiterApiClient: ReturnType<typeof createJupiterApiClient> | null = null;

function getJupiterClient() {
  if (!jupiterApiClient) {
    jupiterApiClient = createJupiterApiClient();
  }
  return jupiterApiClient;
}

/**
 * Get Jupiter swap quote
 * @param inputToken - Input token ticker
 * @param outputToken - Output token ticker
 * @param amount - Amount in human readable format
 * @param slippageBps - Slippage in basis points (default 50 = 0.5%)
 * @returns Quote response from Jupiter
 */
export async function getJupiterQuote(
  inputToken: TokenTicker,
  outputToken: TokenTicker,
  amount: number,
  slippageBps: number = 50
): Promise<QuoteResponse> {
  const inputMint = TOKEN_ADDRESS[inputToken];
  const outputMint = TOKEN_ADDRESS[outputToken];

  if (!inputMint) {
    throw new Error(`Unknown input token: ${inputToken}`);
  }
  if (!outputMint) {
    throw new Error(`Unknown output token: ${outputToken}`);
  }

  const jupiterApi = getJupiterClient();
  const baseAmount = toBaseUnits(amount, inputToken);

  const quote = await jupiterApi.quoteGet({
    inputMint,
    outputMint,
    amount: baseAmount,
    slippageBps,
    // Limit accounts to keep transaction size under 1232 bytes for Jito bundles
    // SOL-JUP direct routes typically need ~15 accounts
    maxAccounts: 15,
    // Prefer direct routes for smaller transactions
    onlyDirectRoutes: true,
  });

  if (!quote) {
    throw new Error('Failed to get Jupiter quote');
  }

  return quote;
}

/**
 * Build Jupiter swap transaction (unsigned)
 * Returns a VersionedTransaction that needs to be signed by wallet
 *
 * Transaction is serialized/deserialized via base64 to ensure
 * compatibility with Jito bundle submission.
 *
 * NOTE: This function ignores the amount parameter and automatically
 * calculates the required SOL amount to receive at least 250 JUP (with 5% buffer).
 *
 * @param userPublicKey - User's public key
 * @param inputToken - Input token ticker (e.g., 'SOL')
 * @param outputToken - Output token ticker (e.g., 'JUP')
 * @param _amount - IGNORED - Amount is calculated automatically for minimum 250 JUP
 * @param slippageBps - Slippage in basis points (default 50 = 0.5%)
 * @returns Transaction, expected output amount, quote, and calculated SOL amount
 */
export async function buildJupiterSwapTransaction(
  userPublicKey: PublicKey,
  inputToken: TokenTicker,
  outputToken: TokenTicker,
  _amount: number,
  slippageBps: number = 50
): Promise<{ transaction: VersionedTransaction; expectedOutput: number; quote: QuoteResponse; calculatedSolAmount: number }> {
  const inputMint = TOKEN_ADDRESS[inputToken];
  const outputMint = TOKEN_ADDRESS[outputToken];

  if (!inputMint) {
    throw new Error(`Unknown input token: ${inputToken}`);
  }
  if (!outputMint) {
    throw new Error(`Unknown output token: ${outputToken}`);
  }

  // Calculate required SOL amount for minimum 250 JUP (with 5% buffer)
  const { solAmount: calculatedSolAmount } = await calculateRequiredSolForMinimumJup();

  console.log('Calculated SOL amount for minimum 250 JUP:', calculatedSolAmount);

  const jupiterApi = getJupiterClient();

  // 1. Get quote using calculated SOL amount
  const quote = await getJupiterQuote(inputToken, outputToken, calculatedSolAmount, slippageBps);

  // 2. Get serialized swap transaction (base64 encoded from Jupiter API)
  // Use asLegacyTransaction to avoid Address Lookup Tables (Jito doesn't support ALTs)
  const swapResult = await jupiterApi.swapPost({
    swapRequest: {
      quoteResponse: quote,
      userPublicKey: userPublicKey.toBase58(),
      wrapAndUnwrapSol: true,
      asLegacyTransaction: true, // Required for Jito bundle compatibility
      // Don't sign - we'll sign with wallet adapter later
      // dynamicComputeUnitLimit: true,
      // prioritizationFeeLamports: 'auto', // Let Jito tip handle priority
    },
  });

  if (!swapResult || !swapResult.swapTransaction) {
    throw new Error('Failed to get Jupiter swap transaction');
  }

  // 3. Transaction is already base64 encoded from Jupiter API
  // Deserialize from base64 for wallet adapter signing
  const base64Transaction = swapResult.swapTransaction;
  const transactionBytes = Buffer.from(base64Transaction, 'base64');
  const transaction = VersionedTransaction.deserialize(transactionBytes);

  // 4. Validate that Jupiter returned a legacy-compatible transaction (no ALTs)
  // Even with asLegacyTransaction: true, some routes may still require V0 format
  if (transaction.message.version === 0) {
    const v0Message = transaction.message as any;
    if (v0Message.addressTableLookups?.length > 0) {
      throw new Error(
        'Jupiter returned a V0 transaction with Address Lookup Tables. ' +
        'This swap route is too complex for Jito bundles. Try a smaller amount or different token pair.'
      );
    }
  }

  // 5. Check transaction size (must be <= 1232 bytes for Solana/Jito)
  if (transactionBytes.length > 1232) {
    throw new Error(
      `Jupiter swap transaction too large (${transactionBytes.length} > 1232 bytes). ` +
      'Try a smaller amount or the swap route is too complex for Jito bundles.'
    );
  }

  console.log('Jupiter transaction validated:', {
    version: transaction.message.version,
    blockhash: transaction.message.recentBlockhash,
    size: transactionBytes.length,
  });

  // 6. Calculate expected output in human readable format
  const expectedOutput = fromBaseUnits(quote.outAmount, outputToken);

  return {
    transaction,
    expectedOutput,
    quote,
    calculatedSolAmount,
  };
}

/**
 * Build Jupiter swap transaction using Ultra API (alternative method)
 * Ultra API provides better execution with MEV protection
 * 
 * @param userPublicKey - User's public key
 * @param inputToken - Input token ticker
 * @param outputToken - Output token ticker
 * @param amount - Amount in human readable format
 * @returns Transaction and expected output amount
 */
export async function buildJupiterSwapTransactionUltra(
  userPublicKey: PublicKey,
  inputToken: TokenTicker,
  outputToken: TokenTicker,
  amount: number
): Promise<{ transaction: VersionedTransaction; expectedOutput: number }> {
  const inputMint = TOKEN_ADDRESS[inputToken];
  const outputMint = TOKEN_ADDRESS[outputToken];

  if (!inputMint) {
    throw new Error(`Unknown input token: ${inputToken}`);
  }
  if (!outputMint) {
    throw new Error(`Unknown output token: ${outputToken}`);
  }

  const baseAmount = toBaseUnits(amount, inputToken);

  // Use Jupiter Ultra API
  const response = await fetch(
    `https://api.jup.ag/ultra/v1/order?` +
    `inputMint=${inputMint}&` +
    `outputMint=${outputMint}&` +
    `amount=${baseAmount}&` +
    `taker=${userPublicKey.toBase58()}&` +
    `excludeRouters=jupiterz`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        // Add your API key if you have one
        // 'x-api-key': 'YOUR_API_KEY',
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Jupiter Ultra API error: ${response.status} - ${errorText}`);
  }

  const result = await response.json();

  if (!result.transaction) {
    throw new Error('No transaction returned from Jupiter Ultra API');
  }

  // Transaction is base64 encoded from API
  const base64Transaction = result.transaction;
  const transactionBytes = Buffer.from(base64Transaction, 'base64');
  const transaction = VersionedTransaction.deserialize(transactionBytes);

  const expectedOutput = fromBaseUnits(result.outAmount, outputToken);

  return {
    transaction,
    expectedOutput,
  };
}

/**
 * Verify transaction is properly base64 serializable
 * Useful for debugging Jito bundle issues
 */
export function verifyTransactionBase64(transaction: VersionedTransaction): {
  isValid: boolean;
  base64: string;
  byteLength: number;
} {
  try {
    const serialized = transaction.serialize();
    const base64 = Buffer.from(serialized).toString('base64');
    
    // Verify round-trip
    const decoded = Buffer.from(base64, 'base64');
    const restored = VersionedTransaction.deserialize(decoded);
    
    // Check message bytes match
    const isValid = Buffer.from(restored.message.serialize()).equals(
      Buffer.from(transaction.message.serialize())
    );

    return {
      isValid,
      base64,
      byteLength: serialized.length,
    };
  } catch (error) {
    return {
      isValid: false,
      base64: '',
      byteLength: 0,
    };
  }
}