import React from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useAtomicSwapShort, AtomicOperationStep } from '../hooks/useAtomicSwapShort';
import { AtomicOperationConfig } from '../types';

interface AtomicSwapButtonProps {
  config: AtomicOperationConfig;
  onSuccess?: (bundleId: string) => void;
  onError?: (error: string) => void;
  className?: string;
}

// Step to display text mapping
const STEP_MESSAGES: Record<AtomicOperationStep, string> = {
  idle: '🚀 Execute Atomic Operation',
  building_swap: '🔄 Building Jupiter Swap...',
  building_short: '📉 Building Drift Short...',
  building_transfer: '💸 Building Transfer...',
  building_tip: '💰 Building Jito Tip...',
  signing: '✍️ Waiting for Signature...',
  submitting: '📤 Submitting to Jito...',
  confirming: '⏳ Confirming Bundle...',
  success: '✅ Success!',
  error: '❌ Failed',
};

export const AtomicSwapButton: React.FC<AtomicSwapButtonProps> = ({
  config,
  onSuccess,
  onError,
  className,
}) => {
  const { connected } = useWallet();
  const { execute, progress, result, isExecuting, reset } = useAtomicSwapShort();

  const handleClick = async () => {
    if (!connected) {
      alert('Please connect your wallet first');
      return;
    }

    // Validate config
    if (!config.targetAddress) {
      alert('Please enter a target address');
      return;
    }

    if (config.shortAmount <= 0 || config.transferAmount <= 0) {
      alert('Short amount and transfer amount must be greater than 0');
      return;
    }

    const bundleResult = await execute(config);

    if (bundleResult.success) {
      onSuccess?.(bundleResult.bundleId);
    } else {
      onError?.(bundleResult.error || 'Unknown error');
    }
  };

  const handleReset = () => {
    reset();
  };

  const isDisabled = !connected || isExecuting;
  const showReset = progress.step === 'success' || progress.step === 'error';

  return (
    <div className={`atomic-swap-button-container ${className || ''}`}>
      {/* Main Button */}
      <button
        onClick={showReset ? handleReset : handleClick}
        disabled={isDisabled && !showReset}
        className={`atomic-swap-button ${isExecuting ? 'executing' : ''} ${
          progress.step === 'success' ? 'success' : ''
        } ${progress.step === 'error' ? 'error' : ''}`}
        style={{
          padding: '16px 32px',
          fontSize: '16px',
          fontWeight: 'bold',
          borderRadius: '12px',
          border: 'none',
          cursor: isDisabled && !showReset ? 'not-allowed' : 'pointer',
          backgroundColor: isExecuting
            ? '#6366f1'
            : progress.step === 'success'
            ? '#22c55e'
            : progress.step === 'error'
            ? '#ef4444'
            : '#3b82f6',
          color: 'white',
          transition: 'all 0.2s ease',
          minWidth: '300px',
        }}
      >
        {showReset ? '🔄 Reset' : STEP_MESSAGES[progress.step]}
      </button>

      {/* Progress Display */}
      {isExecuting && (
        <div
          className="progress-display"
          style={{
            marginTop: '16px',
            padding: '16px',
            backgroundColor: '#1e293b',
            borderRadius: '8px',
            color: '#e2e8f0',
          }}
        >
          <div style={{ marginBottom: '8px', fontWeight: 'bold' }}>
            {progress.message}
          </div>
          {progress.swapExpectedOutput && (
            <div style={{ fontSize: '14px', color: '#94a3b8' }}>
              Expected swap output: ~{progress.swapExpectedOutput.toFixed(4)} JUP
            </div>
          )}
          <div
            style={{
              marginTop: '12px',
              height: '4px',
              backgroundColor: '#334155',
              borderRadius: '2px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: '100%',
                backgroundColor: '#6366f1',
                animation: 'progress-pulse 1.5s ease-in-out infinite',
              }}
            />
          </div>
        </div>
      )}

      {/* Result Display */}
      {result && !isExecuting && (
        <div
          className="result-display"
          style={{
            marginTop: '16px',
            padding: '16px',
            backgroundColor: result.success ? '#052e16' : '#450a0a',
            borderRadius: '8px',
            color: result.success ? '#86efac' : '#fca5a5',
          }}
        >
          {result.success ? (
            <>
              <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>
                ✅ Bundle Confirmed!
              </div>
              <div style={{ fontSize: '14px', wordBreak: 'break-all' }}>
                Bundle ID: {result.bundleId}
              </div>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>
                ❌ Bundle Failed
              </div>
              <div style={{ fontSize: '14px' }}>{result.error}</div>
            </>
          )}
        </div>
      )}

      {/* CSS for animation */}
      <style>{`
        @keyframes progress-pulse {
          0%, 100% { opacity: 0.4; transform: translateX(-100%); }
          50% { opacity: 1; transform: translateX(0); }
        }
        .atomic-swap-button:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
        }
        .atomic-swap-button:active:not(:disabled) {
          transform: translateY(0);
        }
        .atomic-swap-button.executing {
          animation: pulse 2s infinite;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
      `}</style>
    </div>
  );
};

export default AtomicSwapButton;
