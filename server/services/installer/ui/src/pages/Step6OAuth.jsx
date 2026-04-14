import React, { useState, useEffect } from 'react';

function Step6OAuth({ api, config, onComplete, onBack }) {
  const [requirements, setRequirements] = useState(null);
  const [microsoft, setMicrosoft] = useState({
    clientId: '',
    clientSecret: '',
    tenant: 'common',
  });
  const [google, setGoogle] = useState({
    clientId: '',
    clientSecret: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadRequirements();
  }, []);

  const loadRequirements = async () => {
    try {
      const result = await api.get('/api/wizard/step/6/oauth-requirements');
      setRequirements(result);
    } catch (err) {
      console.error(err);
    }
  };

  const handleContinue = async () => {
    setSaving(true);
    setError('');

    try {
      const result = await api.post('/api/wizard/step/6/configure-oauth', {
        microsoft: microsoft.clientId ? microsoft : undefined,
        google: google.clientId ? google : undefined,
      });

      if (result.success) {
        onComplete({
          oauthConfigured: true,
          microsoftOAuth: !!microsoft.clientId,
          googleOAuth: !!google.clientId,
        });
      } else {
        setError(result.error || 'Failed to configure OAuth');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = () => {
    onComplete({ oauthConfigured: false });
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-notely-dark mb-2">OAuth Configuration</h2>
      <p className="text-gray-600 mb-6">
        Configure OAuth providers for user authentication. This step is optional and can be completed later.
      </p>

      {/* Microsoft OAuth */}
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-lg">Microsoft (Azure AD)</h3>
          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">Optional</span>
        </div>

        <p className="text-sm text-gray-600 mb-4">
          Required for Microsoft 365 login, Teams calendar sync, and Outlook integration.
        </p>

        {requirements?.providers?.[0]?.redirectUris?.length > 0 && (
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm font-medium text-blue-800 mb-2">Required Redirect URIs</p>
            <div className="space-y-1">
              {requirements.providers[0].redirectUris.map((uri) => (
                <div key={uri} className="flex items-center gap-2">
                  <code className="text-xs bg-blue-100 px-2 py-1 rounded flex-1 overflow-x-auto">
                    {uri}
                  </code>
                  <button
                    onClick={() => copyToClipboard(uri)}
                    className="text-blue-600 hover:text-blue-800 text-sm"
                  >
                    Copy
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Client ID</label>
            <input
              type="text"
              value={microsoft.clientId}
              onChange={(e) => setMicrosoft({ ...microsoft, clientId: e.target.value })}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              className="input-field text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Client Secret</label>
            <input
              type="password"
              value={microsoft.clientSecret}
              onChange={(e) => setMicrosoft({ ...microsoft, clientSecret: e.target.value })}
              placeholder="Enter client secret"
              className="input-field text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tenant ID</label>
            <input
              type="text"
              value={microsoft.tenant}
              onChange={(e) => setMicrosoft({ ...microsoft, tenant: e.target.value })}
              placeholder="common, organizations, or tenant ID"
              className="input-field text-sm"
            />
            <p className="text-xs text-gray-500 mt-1">
              Use "common" for multi-tenant, or your specific tenant ID
            </p>
          </div>
        </div>
      </div>

      {/* Google OAuth */}
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-lg">Google</h3>
          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">Optional</span>
        </div>

        <p className="text-sm text-gray-600 mb-4">
          Required for Google login and Google Calendar integration.
        </p>

        {requirements?.providers?.[1]?.redirectUris?.length > 0 && (
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm font-medium text-blue-800 mb-2">Required Redirect URIs</p>
            <div className="space-y-1">
              {requirements.providers[1].redirectUris.map((uri) => (
                <div key={uri} className="flex items-center gap-2">
                  <code className="text-xs bg-blue-100 px-2 py-1 rounded flex-1 overflow-x-auto">
                    {uri}
                  </code>
                  <button
                    onClick={() => copyToClipboard(uri)}
                    className="text-blue-600 hover:text-blue-800 text-sm"
                  >
                    Copy
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Client ID</label>
            <input
              type="text"
              value={google.clientId}
              onChange={(e) => setGoogle({ ...google, clientId: e.target.value })}
              placeholder="xxxxxxxxxxxx.apps.googleusercontent.com"
              className="input-field text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Client Secret</label>
            <input
              type="password"
              value={google.clientSecret}
              onChange={(e) => setGoogle({ ...google, clientSecret: e.target.value })}
              placeholder="Enter client secret"
              className="input-field text-sm"
            />
          </div>
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
        <div className="flex gap-2">
          <button onClick={handleSkip} className="btn-secondary">
            Skip for Now
          </button>
          <button
            onClick={handleContinue}
            disabled={saving}
            className="btn-primary"
          >
            {saving ? 'Saving...' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default Step6OAuth;
