import React, { useState } from 'react';

function Step5Secrets({ api, onComplete, onBack }) {
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [validation, setValidation] = useState(null);
  const [error, setError] = useState('');

  const handleGenerate = async () => {
    setGenerating(true);
    setError('');

    try {
      const result = await api.post('/api/wizard/step/5/generate-secrets', {});

      if (result.success) {
        setGenerated(true);
        // Validate the generated secrets
        const validationResult = await api.get('/api/wizard/step/5/validate-secrets');
        setValidation(validationResult);
      } else {
        setError(result.error || 'Failed to generate secrets');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleContinue = () => {
    onComplete({ secretsGenerated: true });
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-notely-dark mb-2">Database & Security Secrets</h2>
      <p className="text-gray-600 mb-6">
        Generate secure passwords and encryption keys for your installation.
      </p>

      <div className="card mb-6">
        <h3 className="font-semibold text-lg mb-4">What will be generated</h3>
        <ul className="space-y-2 text-gray-600">
          <li className="flex items-center gap-2">
            <span className="w-2 h-2 bg-notely-accent rounded-full" />
            JWT signing keys (RSA 4096-bit)
          </li>
          <li className="flex items-center gap-2">
            <span className="w-2 h-2 bg-notely-accent rounded-full" />
            Encryption key (256-bit)
          </li>
          <li className="flex items-center gap-2">
            <span className="w-2 h-2 bg-notely-accent rounded-full" />
            PostgreSQL admin and service passwords
          </li>
          <li className="flex items-center gap-2">
            <span className="w-2 h-2 bg-notely-accent rounded-full" />
            Redis password
          </li>
          <li className="flex items-center gap-2">
            <span className="w-2 h-2 bg-notely-accent rounded-full" />
            Webhook signing secrets
          </li>
          <li className="flex items-center gap-2">
            <span className="w-2 h-2 bg-notely-accent rounded-full" />
            Internal API keys
          </li>
        </ul>
      </div>

      {!generated ? (
        <div className="card mb-6 text-center py-8">
          <div className="w-16 h-16 bg-notely-light rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-notely-dark" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h4 className="font-semibold text-lg mb-2">Ready to Generate</h4>
          <p className="text-gray-600 text-sm mb-4">
            All secrets will be cryptographically secure and unique to this installation.
          </p>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="btn-primary"
          >
            {generating ? 'Generating...' : 'Generate Secrets'}
          </button>
        </div>
      ) : (
        <div className="card mb-6 bg-green-50 border-green-200">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <h4 className="font-semibold text-green-800">Secrets Generated Successfully</h4>
              <p className="text-sm text-green-700">
                {validation?.secretCount || 'All'} secrets have been created
              </p>
            </div>
          </div>

          {validation?.issues?.length > 0 && (
            <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
              <p className="text-sm font-medium text-yellow-800 mb-1">Warnings:</p>
              <ul className="text-sm text-yellow-700">
                {validation.issues.map((issue, i) => (
                  <li key={i}>• {issue.key}: {issue.issue}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="card mb-6 bg-amber-50 border-amber-200">
        <h4 className="font-medium text-amber-800 mb-2">Important</h4>
        <ul className="text-sm text-amber-700 space-y-1">
          <li>• Secrets are stored in <code className="bg-amber-100 px-1 rounded">config/secrets.*.env</code></li>
          <li>• Back up this file securely after installation</li>
          <li>• Never commit secrets to version control</li>
          <li>• Rotate secrets quarterly for security</li>
        </ul>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      <div className="flex justify-between">
        <button onClick={onBack} className="btn-secondary">
          Back
        </button>
        <button
          onClick={handleContinue}
          disabled={!generated}
          className="btn-primary"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

export default Step5Secrets;
