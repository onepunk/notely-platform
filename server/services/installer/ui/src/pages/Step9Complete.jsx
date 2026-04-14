import React, { useState, useEffect } from 'react';

function Step9Complete({ api, config }) {
  const [status, setStatus] = useState(null);
  const [shuttingDown, setShuttingDown] = useState(false);

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      const result = await api.get('/api/wizard/step/9/status');
      setStatus(result);
    } catch (err) {
      console.error(err);
    }
  };

  const handleShutdown = async () => {
    if (!window.confirm('This will shut down the installer. Are you sure?')) {
      return;
    }

    setShuttingDown(true);
    try {
      await api.post('/api/wizard/step/9/shutdown-installer');
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div>
      <div className="text-center mb-8">
        <div className="w-20 h-20 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-3xl font-bold text-notely-dark mb-2">Installation Complete!</h2>
        <p className="text-gray-600">
          Notely Platform has been successfully deployed.
        </p>
      </div>

      {status?.urls && (
        <div className="card mb-6">
          <h3 className="font-semibold text-lg mb-4">Access Your Platform</h3>
          <div className="space-y-3">
            <a
              href={status.urls.portal}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between p-4 bg-notely-light rounded-lg hover:bg-gray-100 transition-colors"
            >
              <div>
                <p className="font-medium">Admin Portal</p>
                <p className="text-sm text-gray-500">Manage users, settings, and licenses</p>
              </div>
              <code className="text-sm bg-white px-3 py-1 rounded">{status.urls.portal}</code>
            </a>

            <a
              href={status.urls.api}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between p-4 bg-notely-light rounded-lg hover:bg-gray-100 transition-colors"
            >
              <div>
                <p className="font-medium">API Endpoint</p>
                <p className="text-sm text-gray-500">REST API for integrations</p>
              </div>
              <code className="text-sm bg-white px-3 py-1 rounded">{status.urls.api}</code>
            </a>
          </div>
        </div>
      )}

      <div className="card mb-6">
        <h3 className="font-semibold text-lg mb-4">Login Credentials</h3>
        <div className="p-4 bg-notely-light rounded-lg">
          <p className="text-sm text-gray-600 mb-2">Admin Email:</p>
          <p className="font-medium">{status?.adminEmail || config?.adminEmail}</p>
          <p className="text-sm text-gray-500 mt-2">
            Use the password you created during setup.
          </p>
        </div>
      </div>

      <div className="card mb-6">
        <h3 className="font-semibold text-lg mb-4">Next Steps</h3>
        <ol className="space-y-3">
          <li className="flex items-start gap-3">
            <span className="w-6 h-6 bg-notely-dark text-white rounded-full flex items-center justify-center text-sm flex-shrink-0">1</span>
            <div>
              <p className="font-medium">Log in to the Admin Portal</p>
              <p className="text-sm text-gray-600">Use your admin credentials to access the dashboard</p>
            </div>
          </li>
          <li className="flex items-start gap-3">
            <span className="w-6 h-6 bg-notely-dark text-white rounded-full flex items-center justify-center text-sm flex-shrink-0">2</span>
            <div>
              <p className="font-medium">Configure OAuth (if skipped)</p>
              <p className="text-sm text-gray-600">Set up Microsoft or Google OAuth for user authentication</p>
            </div>
          </li>
          <li className="flex items-start gap-3">
            <span className="w-6 h-6 bg-notely-dark text-white rounded-full flex items-center justify-center text-sm flex-shrink-0">3</span>
            <div>
              <p className="font-medium">Install Production SSL Certificates</p>
              <p className="text-sm text-gray-600">Replace self-signed certificates with CA-signed ones</p>
            </div>
          </li>
          <li className="flex items-start gap-3">
            <span className="w-6 h-6 bg-notely-dark text-white rounded-full flex items-center justify-center text-sm flex-shrink-0">4</span>
            <div>
              <p className="font-medium">Download Desktop Apps</p>
              <p className="text-sm text-gray-600">Install Notely desktop clients for your users</p>
            </div>
          </li>
        </ol>
      </div>

      <div className="card mb-6 bg-amber-50 border-amber-200">
        <h4 className="font-medium text-amber-800 mb-2">Important Reminders</h4>
        <ul className="text-sm text-amber-700 space-y-1">
          <li>• Back up <code className="bg-amber-100 px-1 rounded">config/secrets.*.env</code> securely</li>
          <li>• Set up automated database backups</li>
          <li>• Configure monitoring and alerting</li>
          <li>• Review security settings before going live</li>
        </ul>
      </div>

      <div className="card bg-gray-50">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-medium">Installer Cleanup</h4>
            <p className="text-sm text-gray-600">
              The installer container can be safely removed now.
            </p>
          </div>
          <button
            onClick={handleShutdown}
            disabled={shuttingDown}
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
          >
            {shuttingDown ? 'Shutting down...' : 'Shutdown Installer'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default Step9Complete;
