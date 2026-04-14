import React, { useState } from 'react';

function AuthScreen({ onAuth }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      const data = await response.json();

      if (data.success) {
        onAuth(data.sessionId);
      } else {
        setError(data.error || 'Invalid token');
      }
    } catch (err) {
      setError('Failed to connect to installer');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="card">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-notely-dark rounded-xl flex items-center justify-center mx-auto mb-4">
              <span className="text-notely-accent text-2xl font-bold">N</span>
            </div>
            <h1 className="text-2xl font-bold text-notely-dark">Notely Platform</h1>
            <p className="text-gray-500 mt-2">Installation Wizard</p>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Setup Token
              </label>
              <input
                type="text"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Enter the token from your terminal"
                className="input-field font-mono"
                autoFocus
              />
              <p className="text-xs text-gray-500 mt-2">
                The setup token was displayed when you started the installer
              </p>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !token}
              className="btn-primary w-full"
            >
              {loading ? 'Verifying...' : 'Begin Installation'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          This installer will shut down after 30 minutes of inactivity
        </p>
      </div>
    </div>
  );
}

export default AuthScreen;
