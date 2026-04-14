import React, { useState, useEffect } from 'react';

function Step8Deploy({ api, config, onComplete, onBack }) {
  const [summary, setSummary] = useState(null);
  const [deploying, setDeploying] = useState(false);
  const [deployOutput, setDeployOutput] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    loadSummary();
  }, []);

  const loadSummary = async () => {
    try {
      const result = await api.get('/api/wizard/step/8/summary');
      setSummary(result);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeploy = async () => {
    setDeploying(true);
    setError('');
    setDeployOutput('Starting deployment...\n');

    try {
      const result = await api.post('/api/wizard/step/8/deploy');

      if (result.success) {
        setDeployOutput((prev) => prev + '\n' + (result.output || 'Deployment completed successfully!'));
        onComplete({ deployed: true });
      } else {
        setError(result.error || 'Deployment failed');
        setDeployOutput((prev) => prev + '\n\nError: ' + (result.error || 'Unknown error'));
      }
    } catch (err) {
      setError(err.message);
      setDeployOutput((prev) => prev + '\n\nError: ' + err.message);
    } finally {
      setDeploying(false);
    }
  };

  const ConfigItem = ({ label, value, status }) => (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
      <span className="text-gray-600">{label}</span>
      <div className="flex items-center gap-2">
        <span className="font-medium">{value || 'Not configured'}</span>
        {status !== undefined && (
          <span className={`w-2 h-2 rounded-full ${status ? 'bg-green-500' : 'bg-gray-300'}`} />
        )}
      </div>
    </div>
  );

  return (
    <div>
      <h2 className="text-2xl font-bold text-notely-dark mb-2">Review & Deploy</h2>
      <p className="text-gray-600 mb-6">
        Review your configuration and start the deployment.
      </p>

      {summary && (
        <>
          <div className="card mb-6">
            <h3 className="font-semibold text-lg mb-4">Configuration Summary</h3>

            <ConfigItem
              label="Deployment Mode"
              value={summary.configuration?.deploymentMode?.toUpperCase()}
              status={!!summary.configuration?.deploymentMode}
            />
            <ConfigItem
              label="Base Domain"
              value={summary.configuration?.baseDomain}
              status={!!summary.configuration?.baseDomain}
            />
            <ConfigItem
              label="SSL Method"
              value={summary.configuration?.sslMethod || 'Not configured'}
              status={summary.configuration?.sslMethod && summary.configuration.sslMethod !== 'skip'}
            />
            <ConfigItem
              label="Secrets"
              value={summary.configuration?.secretsGenerated ? 'Generated' : 'Not generated'}
              status={summary.configuration?.secretsGenerated}
            />
            <ConfigItem
              label="OAuth"
              value={summary.configuration?.oauthConfigured ? 'Configured' : 'Skipped'}
            />
            <ConfigItem
              label="Admin Account"
              value={summary.configuration?.adminEmail}
              status={!!summary.configuration?.adminEmail}
            />
          </div>

          {summary.configuration?.domains && (
            <div className="card mb-6">
              <h3 className="font-semibold text-lg mb-4">Service URLs</h3>
              <div className="space-y-2 text-sm">
                {Object.entries(summary.configuration.domains).map(([name, domain]) => (
                  <div key={name} className="flex items-center justify-between">
                    <span className="text-gray-600 capitalize">{name}</span>
                    <code className="bg-gray-100 px-2 py-1 rounded text-xs">https://{domain}</code>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!summary.readyToDeploy && (
            <div className="card mb-6 bg-amber-50 border-amber-200">
              <h4 className="font-medium text-amber-800 mb-2">Missing Requirements</h4>
              <p className="text-sm text-amber-700">
                Please complete all required steps before deploying:
              </p>
              <ul className="text-sm text-amber-700 mt-2">
                {!summary.configuration?.deploymentMode && <li>• Select deployment mode</li>}
                {!summary.configuration?.baseDomain && <li>• Configure domain</li>}
                {!summary.configuration?.secretsGenerated && <li>• Generate secrets</li>}
              </ul>
            </div>
          )}

          {deploying && (
            <div className="card mb-6">
              <h4 className="font-medium mb-2">Deployment Progress</h4>
              <div className="code-block h-48 overflow-y-auto text-xs whitespace-pre-wrap">
                {deployOutput}
                {deploying && <span className="animate-pulse">▋</span>}
              </div>
            </div>
          )}
        </>
      )}

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      <div className="card mb-6 bg-blue-50 border-blue-200">
        <h4 className="font-medium text-blue-800 mb-2">What happens next</h4>
        <ul className="text-sm text-blue-700 space-y-1">
          <li>• Docker containers will be built and started</li>
          <li>• Database schemas will be initialized</li>
          <li>• SSL certificates will be configured in nginx</li>
          <li>• Services will start and become available</li>
        </ul>
      </div>

      <div className="flex justify-between">
        <button onClick={onBack} disabled={deploying} className="btn-secondary">
          Back
        </button>
        <button
          onClick={handleDeploy}
          disabled={deploying || !summary?.readyToDeploy}
          className="btn-primary"
        >
          {deploying ? 'Deploying...' : 'Start Deployment'}
        </button>
      </div>
    </div>
  );
}

export default Step8Deploy;
