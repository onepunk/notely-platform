import React, { useState } from 'react';

function Step3Domain({ api, config, onComplete, onBack }) {
  const [baseDomain, setBaseDomain] = useState(config.baseDomain || '');
  const [validation, setValidation] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const validateDomain = async () => {
    if (!baseDomain) return;

    try {
      const result = await api.post('/api/wizard/step/3/validate-domain', { baseDomain });
      setValidation(result);
      setError('');
    } catch (err) {
      setError(err.message);
      setValidation(null);
    }
  };

  const handleContinue = async () => {
    setSaving(true);
    setError('');

    try {
      const result = await api.post('/api/wizard/step/3/configure-domain', { baseDomain });

      if (result.success) {
        onComplete({
          baseDomain,
          domains: result.domains,
        });
      } else {
        setError(result.error || 'Failed to configure domain');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-notely-dark mb-2">Domain Configuration</h2>
      <p className="text-gray-600 mb-6">
        Enter your base domain. Subdomains will be automatically configured for each service.
      </p>

      <div className="card mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Base Domain
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={baseDomain}
            onChange={(e) => {
              setBaseDomain(e.target.value);
              setValidation(null);
            }}
            onBlur={validateDomain}
            placeholder="example.com"
            className="input-field flex-1"
          />
          <button onClick={validateDomain} className="btn-secondary">
            Validate
          </button>
        </div>

        {validation && (
          <div className={`mt-4 p-4 rounded-lg ${validation.valid ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
            {validation.valid ? (
              <>
                <p className="font-medium text-green-800 mb-2">Domain is valid</p>
                <p className="text-sm text-green-700 mb-2">The following subdomains will be configured:</p>
                <ul className="text-sm text-green-700 space-y-1">
                  {validation.subdomains?.map((sub) => (
                    <li key={sub}>• {sub}</li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                <p className="font-medium text-red-800 mb-2">Invalid domain</p>
                <ul className="text-sm text-red-700">
                  {validation.issues?.map((issue, i) => (
                    <li key={i}>• {issue}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>

      <div className="card mb-6 bg-amber-50 border-amber-200">
        <h4 className="font-medium text-amber-800 mb-2">DNS Configuration Required</h4>
        <p className="text-sm text-amber-700 mb-2">
          Before proceeding, ensure DNS records point to this server:
        </p>
        <div className="code-block text-xs">
          {baseDomain ? (
            <>
              <div>api.{baseDomain}     A    [your-server-ip]</div>
              <div>portal.{baseDomain}  A    [your-server-ip]</div>
              <div>ws.{baseDomain}      A    [your-server-ip]</div>
              <div>calendar.{baseDomain} A   [your-server-ip]</div>
              <div>get.{baseDomain}     A    [your-server-ip]</div>
            </>
          ) : (
            <div className="text-gray-400">Enter a domain to see required DNS records</div>
          )}
        </div>
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
          disabled={!validation?.valid || saving}
          className="btn-primary"
        >
          {saving ? 'Configuring...' : 'Continue'}
        </button>
      </div>
    </div>
  );
}

export default Step3Domain;
