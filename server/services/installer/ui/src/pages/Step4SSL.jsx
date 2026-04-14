import React, { useState, useEffect } from 'react';

function Step4SSL({ api, config, onComplete, onBack }) {
  const [options, setOptions] = useState([]);
  const [selected, setSelected] = useState('self-signed');
  const [certificate, setCertificate] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadOptions();
  }, []);

  const loadOptions = async () => {
    try {
      const result = await api.get('/api/wizard/step/4/ssl-options');
      setOptions(result.options);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleContinue = async () => {
    setSaving(true);
    setError('');

    try {
      let result;

      if (selected === 'self-signed') {
        result = await api.post('/api/wizard/step/4/generate-ssl');
      } else if (selected === 'bring-your-own') {
        if (!certificate || !privateKey) {
          setError('Please provide both certificate and private key');
          setSaving(false);
          return;
        }
        result = await api.post('/api/wizard/step/4/upload-ssl', {
          certificate,
          privateKey,
        });
      } else {
        // Skip option
        result = { success: true };
      }

      if (result.success) {
        onComplete({ sslMethod: selected });
      } else {
        setError(result.error || 'Failed to configure SSL');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-notely-dark mb-2">SSL Certificates</h2>
      <p className="text-gray-600 mb-6">
        Configure SSL certificates for secure HTTPS connections.
      </p>

      {loading ? (
        <div className="card text-center py-12">
          <div className="animate-spin w-8 h-8 border-4 border-notely-dark border-t-transparent rounded-full mx-auto" />
        </div>
      ) : (
        <>
          <div className="space-y-4 mb-6">
            {options.map((option) => (
              <button
                key={option.id}
                onClick={() => setSelected(option.id)}
                className={`option-card w-full text-left ${selected === option.id ? 'selected' : ''}`}
              >
                <div className="flex items-start gap-4">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5
                    ${selected === option.id ? 'border-notely-dark' : 'border-gray-300'}`}
                  >
                    {selected === option.id && (
                      <div className="w-3 h-3 rounded-full bg-notely-dark" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{option.name}</h3>
                      {option.recommended && (
                        <span className="text-xs bg-notely-accent text-notely-dark px-2 py-0.5 rounded">
                          Recommended
                        </span>
                      )}
                    </div>
                    <p className="text-gray-600 text-sm mt-1">{option.description}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {selected === 'bring-your-own' && (
            <div className="card mb-6">
              <h4 className="font-medium mb-4">Upload Certificates</h4>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Certificate (PEM format)
                </label>
                <textarea
                  value={certificate}
                  onChange={(e) => setCertificate(e.target.value)}
                  placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                  className="input-field font-mono text-sm h-32"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Private Key (PEM format)
                </label>
                <textarea
                  value={privateKey}
                  onChange={(e) => setPrivateKey(e.target.value)}
                  placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
                  className="input-field font-mono text-sm h-32"
                />
              </div>
            </div>
          )}

          {selected === 'self-signed' && (
            <div className="card mb-6 bg-blue-50 border-blue-200">
              <h4 className="font-medium text-blue-800 mb-2">Self-Signed Certificate</h4>
              <p className="text-sm text-blue-700">
                A self-signed certificate will be generated for {config.baseDomain || 'your domain'}.
                Your browser will show a security warning, but the connection will still be encrypted.
                Replace with a proper certificate before going to production.
              </p>
            </div>
          )}

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
              disabled={saving || (selected === 'bring-your-own' && (!certificate || !privateKey))}
              className="btn-primary"
            >
              {saving ? 'Configuring...' : 'Continue'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default Step4SSL;
