import { useState, useCallback } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { VersionedTransaction } from '@solana/web3.js';
import {
  createTipTransaction,
  submitAndConfirmBundle,
} from '../utils/jito';
import { JitoBundleResult, OperationState } from '../types';

export interface UseJitoBundleResult {
  submitBundle: (
    transactions: VersionedTransaction[],
    tipLamports?: number
  ) => Promise<JitoBundleResult>;
  state: OperationState<JitoBundleResult>;
  reset: () => void;
}

const DEFAULT_TIP_LAMPORTS = 10_000; // 0.00001 SOL

export function useJitoBundle(): UseJitoBundleResult {
  const { connection } = useConnection();
  const { publicKey, signAllTransactions } = useWallet();
  const [state, setState] = useState<OperationState<JitoBundleResult>>({ status: 'idle' });

  const reset = useCallback(() => {
    setState({ status: 'idle' });
  }, []);

  const submitBundle = useCallback(
    async (
      transactions: VersionedTransaction[],
      tipLamports: number = DEFAULT_TIP_LAMPORTS
    ): Promise<JitoBundleResult> => {
      if (!publicKey || !signAllTransactions) {
        const result: JitoBundleResult = {
          bundleId: '',
          success: false,
          error: 'Wallet not connected',
        };
        setState({ status: 'error', error: result.error, data: result });
        return result;
      }

      setState({ status: 'loading' });

      try {
        // Create tip transaction
        console.log('Creating tip transaction...');
        const tipTransaction = await createTipTransaction(
          connection,
          publicKey,
          tipLamports,
        );

        // Combine all transactions + tip
        const allTransactions = [...transactions, tipTransaction];

        // Sign all transactions at once with wallet
        console.log(`Signing ${allTransactions.length} transactions...`);
        const signedTransactions = await signAllTransactions(allTransactions);

        // Submit bundle and wait for confirmation
        console.log('Submitting bundle to Jito...');
        const result = await submitAndConfirmBundle(
          signedTransactions,
          connection
        );

        if (result.success) {
          setState({ status: 'success', data: result });
        } else {
          setState({ status: 'error', error: result.error, data: result });
        }

        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const result: JitoBundleResult = {
          bundleId: '',
          success: false,
          error: errorMessage,
        };
        setState({ status: 'error', error: errorMessage, data: result });
        return result;
      }
    },
    [connection, publicKey, signAllTransactions]
  );

  return {
    submitBundle,
    state,
    reset,
  };
}
