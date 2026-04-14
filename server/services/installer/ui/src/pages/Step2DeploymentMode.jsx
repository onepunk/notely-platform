import React, { useState, useEffect } from 'react';

function Step2DeploymentMode({ api, onComplete, onBack }) {
  const [modes, setModes] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadModes();
  }, []);

  const loadModes = async () => {
    try {
      const result = await api.get('/api/wizard/step/2/deployment-modes');
      setModes(result.modes);
      // Pre-select recommended option
      const recommended = result.modes.find((m) => m.recommended);
      if (recommended) setSelected(recommended.id);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleContinue = async () => {
    setSaving(true);
    try {
      await api.post('/api/wizard/step/2/deployment-mode', { mode: selected });
      onComplete({ deploymentMode: selected });
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-notely-dark mb-2">Deployment Mode</h2>
      <p className="text-gray-600 mb-6">
        Select how you want to deploy the Notely Platform. This affects port configuration and OAuth URLs.
      </p>

      {loading ? (
        <div className="card text-center py-12">
          <div className="animate-spin w-8 h-8 border-4 border-notely-dark border-t-transparent rounded-full mx-auto" />
        </div>
      ) : (
        <>
          <div className="space-y-4 mb-8">
            {modes.map((mode) => (
              <button
                key={mode.id}
                onClick={() => setSelected(mode.id)}
                className={`option-card w-full text-left ${selected === mode.id ? 'selected' : ''}`}
              >
                <div className="flex items-start gap-4">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5
                    ${selected === mode.id ? 'border-notely-dark' : 'border-gray-300'}`}
                  >
                    {selected === mode.id && (
                      <div className="w-3 h-3 rounded-full bg-notely-dark" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{mode.name}</h3>
                      {mode.recommended && (
                        <span className="text-xs bg-notely-accent text-notely-dark px-2 py-0.5 rounded">
                          Recommended
                        </span>
                      )}
                    </div>
                    <p className="text-gray-600 text-sm mt-1">{mode.description}</p>
                    <div className="flex gap-4 mt-2 text-sm text-gray-500">
                      <span>HTTPS: {mode.ports.https}</span>
                      <span>HTTP: {mode.ports.http}</span>
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <h4 className="font-medium text-blue-800 mb-1">Note about OAuth URLs</h4>
            <p className="text-sm text-blue-700">
              The deployment mode determines the ports used in OAuth callback URLs.
              Make sure to configure your OAuth applications (Microsoft Azure, Google Cloud)
              with the correct redirect URIs for your selected mode.
            </p>
          </div>

          <div className="flex justify-between">
            <button onClick={onBack} className="btn-secondary">
              Back
            </button>
            <button
              onClick={handleContinue}
              disabled={!selected || saving}
              className="btn-primary"
            >
              {saving ? 'Saving...' : 'Continue'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default Step2DeploymentMode;
