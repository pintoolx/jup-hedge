import { useState, useCallback } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { VersionedTransaction } from '@solana/web3.js';
import { DriftClient } from '@drift-labs/sdk';
import { buildJupiterSwapTransaction } from '../utils/jupiter_swap';
import {
  BrowserWallet,
  initializeDriftClient,
  buildDriftShortTransaction,
  cleanupDriftClient,
} from '../utils/drift';
import { buildTokenTransferTransaction } from '../utils/transfer';
import { createTipTransaction, submitAndConfirmBundle } from '../utils/jito';
import {
  JITO_ENDPOINTS,
  AtomicOperationConfig,
  JitoBundleResult,
} from '../types';

export type AtomicOperationStep =
  | 'idle'
  | 'building_swap'
  | 'building_short'
  | 'building_transfer'
  | 'building_tip'
  | 'signing'
  | 'submitting'
  | 'confirming'
  | 'success'
  | 'error';

export interface AtomicOperationProgress {
  step: AtomicOperationStep;
  message: string;
  swapExpectedOutput?: number;
}

export interface UseAtomicSwapShortResult {
  execute: (config: AtomicOperationConfig) => Promise<JitoBundleResult>;
  progress: AtomicOperationProgress;
  result: JitoBundleResult | null;
  isExecuting: boolean;
  reset: () => void;
}

const DEFAULT_TIP_LAMPORTS = 50_000; // 0.00005 SOL

export function useAtomicSwapShort(): UseAtomicSwapShortResult {
  const { connection } = useConnection();
  const { publicKey, signAllTransactions, signTransaction } = useWallet();

  const [progress, setProgress] = useState<AtomicOperationProgress>({
    step: 'idle',
    message: 'Ready',
  });
  const [result, setResult] = useState<JitoBundleResult | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);

  const reset = useCallback(() => {
    setProgress({ step: 'idle', message: 'Ready' });
    setResult(null);
    setIsExecuting(false);
  }, []);

  const execute = useCallback(
    async (config: AtomicOperationConfig): Promise<JitoBundleResult> => {
      if (!publicKey || !signAllTransactions || !signTransaction) {
        const errorResult: JitoBundleResult = {
          bundleId: '',
          success: false,
          error: 'Wallet not connected',
        };
        setResult(errorResult);
        return errorResult;
      }

      setIsExecuting(true);
      setResult(null);

      const {
        solAmount,
        shortAmount,
        transferAmount,
        targetAddress,
        depositAmount,
        jitoTipLamports = DEFAULT_TIP_LAMPORTS,
      } = config;

      const transactions: VersionedTransaction[] = [];
      let driftClient: DriftClient | null = null;

      try {
        // Step 1: Build Jupiter Swap Transaction (SOL → JUP)
        setProgress({
          step: 'building_swap',
          message: `Building Jupiter swap: ${solAmount} SOL → JUP...`,
        });

        const { transaction: swapTx, expectedOutput: expectedJup } = await buildJupiterSwapTransaction(
          publicKey,
          'SOL',
          'JUP',
          solAmount
        );

        //transactions.push(swapTx);

        // Extract blockhash from Jupiter's transaction to use for all other transactions
        // This ensures bundle atomicity - all transactions use the same blockhash
        const sharedBlockhash = swapTx.message.recentBlockhash;
        console.log('Using shared blockhash for bundle:', sharedBlockhash);

        setProgress({
          step: 'building_swap',
          message: `Swap built: ${solAmount} SOL → ~${expectedJup.toFixed(4)} JUP`,
          swapExpectedOutput: expectedJup,
        });

        // Step 2: Build Drift Short Transaction (with optional deposit)
        const depositMsg = depositAmount ? ` (with ${depositAmount} USDC deposit)` : '';
        setProgress({
          step: 'building_short',
          message: `Building Drift short: ${shortAmount} JUP-PERP${depositMsg}...`,
          swapExpectedOutput: expectedJup,
        });

        // Initialize Drift client
        const browserWallet = new BrowserWallet(
          publicKey,
          signTransaction,
          signAllTransactions
        );
        driftClient = await initializeDriftClient(connection, browserWallet);

        // Build short transaction with optional deposit included
        // Pass sharedBlockhash to ensure all bundle transactions use the same blockhash
        const shortTx = await buildDriftShortTransaction(
          connection,
          publicKey,
          driftClient,
          'JUP-PERP',
          shortAmount,
          depositAmount, // Will be included in the same transaction if specified
          0, // subAccountId
          sharedBlockhash
        );
        //transactions.push(shortTx);

        // Cleanup Drift client
        await cleanupDriftClient(driftClient);
        driftClient = null;

        setProgress({
          step: 'building_short',
          message: `Short position built: ${shortAmount} JUP-PERP${depositMsg}`,
          swapExpectedOutput: expectedJup,
        });

        // Step 3: Build Token Transfer Transaction
        setProgress({
          step: 'building_transfer',
          message: `Building JUP transfer: ${transferAmount} JUP → ${targetAddress.slice(0, 8)}...`,
          swapExpectedOutput: expectedJup,
        });

        const transferTx = await buildTokenTransferTransaction(
          connection,
          publicKey,
          'JUP',
          targetAddress,
          transferAmount,
          sharedBlockhash
        );
        transactions.push(transferTx);

        setProgress({
          step: 'building_transfer',
          message: `Transfer built: ${transferAmount} JUP`,
          swapExpectedOutput: expectedJup,
        });

        // Step 4: Build Tip Transaction
        setProgress({
          step: 'building_tip',
          message: `Building Jito tip: ${jitoTipLamports / 1e9} SOL...`,
          swapExpectedOutput: expectedJup,
        });

        const tipTx = await createTipTransaction(
          connection,
          publicKey,
          jitoTipLamports,
          sharedBlockhash
        );
        transactions.push(tipTx);

        // Step 5: Sign all transactions
        setProgress({
          step: 'signing',
          message: `Please sign ${transactions.length} transactions in your wallet...`,
          swapExpectedOutput: expectedJup,
        });


        const signedTransactions = await signAllTransactions(transactions);

        // Step 6: Submit bundle
        setProgress({
          step: 'submitting',
          message: 'Submitting bundle to Jito Block Engine...',
          swapExpectedOutput: expectedJup,
        });

        const bundleResult = await submitAndConfirmBundle(
          signedTransactions,
          connection
        );

        if (bundleResult.success) {
          setProgress({
            step: 'success',
            message: `Bundle confirmed! ID: ${bundleResult.bundleId}`,
            swapExpectedOutput: expectedJup,
          });
        } else {
          setProgress({
            step: 'error',
            message: `Bundle failed: ${bundleResult.error}`,
            swapExpectedOutput: expectedJup,
          });
        }

        setResult(bundleResult);
        setIsExecuting(false);
        return bundleResult;
      } catch (error) {
        // Cleanup Drift client on error
        if (driftClient) {
          await cleanupDriftClient(driftClient);
        }

        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorResult: JitoBundleResult = {
          bundleId: '',
          success: false,
          error: errorMessage,
        };

        setProgress({
          step: 'error',
          message: `Error: ${errorMessage}`,
        });
        setResult(errorResult);
        setIsExecuting(false);
        return errorResult;
      }
    },
    [connection, publicKey, signAllTransactions, signTransaction]
  );

  return {
    execute,
    progress,
    result,
    isExecuting,
    reset,
  };
}
