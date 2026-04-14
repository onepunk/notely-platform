import React, { useState, useEffect } from 'react';

function Step1Prerequisites({ api, onComplete }) {
  const [checks, setChecks] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    runChecks();
  }, []);

  const runChecks = async () => {
    setLoading(true);
    setError('');

    try {
      const result = await api.get('/api/wizard/step/1/prerequisites');
      setChecks(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const CheckItem = ({ label, passed, warning, details }) => (
    <div className="check-item">
      <div className={`check-icon ${passed ? 'pass' : warning ? 'warn' : 'fail'}`}>
        {passed ? '✓' : warning ? '!' : '✗'}
      </div>
      <div className="flex-1">
        <span className="font-medium">{label}</span>
        {details && <span className="text-gray-500 text-sm ml-2">{details}</span>}
      </div>
    </div>
  );

  return (
    <div>
      <h2 className="text-2xl font-bold text-notely-dark mb-2">Prerequisites Check</h2>
      <p className="text-gray-600 mb-6">
        Verifying that your system meets the requirements for running Notely Platform.
      </p>

      {loading ? (
        <div className="card text-center py-12">
          <div className="animate-spin w-8 h-8 border-4 border-notely-dark border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-500">Checking system requirements...</p>
        </div>
      ) : error ? (
        <div className="card bg-red-50 border-red-200">
          <p className="text-red-700">{error}</p>
          <button onClick={runChecks} className="btn-secondary mt-4">
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="card mb-6">
            <h3 className="font-semibold text-lg mb-4">Docker</h3>
            <CheckItem
              label="Docker Engine"
              passed={checks.checks?.docker?.docker?.available}
              details={checks.checks?.docker?.docker?.version && `v${checks.checks.docker.docker.version}`}
            />
            <CheckItem
              label="Docker Compose"
              passed={checks.checks?.docker?.compose?.available}
              details={checks.checks?.docker?.compose?.version && `v${checks.checks.docker.compose.version}`}
            />
            <CheckItem
              label="Docker Socket"
              passed={checks.checks?.docker?.socket?.available}
            />
          </div>

          <div className="card mb-6">
            <h3 className="font-semibold text-lg mb-4">System Resources</h3>
            <CheckItem
              label="Memory"
              passed={checks.checks?.memory?.adequate}
              warning={checks.checks?.memory?.adequate && !checks.checks?.memory?.recommended}
              details={checks.checks?.memory?.totalMB && `${Math.round(checks.checks.memory.totalMB / 1024)}GB total`}
            />
            <CheckItem
              label="Disk Space"
              passed={checks.checks?.disk?.adequate}
              warning={checks.checks?.disk?.adequate && !checks.checks?.disk?.recommended}
              details={checks.checks?.disk?.availableGB && `${checks.checks.disk.availableGB}GB available`}
            />
          </div>

          <div className="card mb-6">
            <h3 className="font-semibold text-lg mb-4">Ports</h3>
            {checks.checks?.ports?.ports && Object.entries(checks.checks.ports.ports).map(([port, status]) => (
              <CheckItem
                key={port}
                label={`Port ${port}`}
                passed={status.available}
                details={status.available ? 'Available' : 'In use'}
              />
            ))}
          </div>

          <div className="flex justify-end gap-4">
            <button onClick={runChecks} className="btn-secondary">
              Re-check
            </button>
            <button
              onClick={() => onComplete({ prerequisitesPassed: checks.passed })}
              disabled={!checks.passed}
              className="btn-primary"
            >
              {checks.passed ? 'Continue' : 'Fix Issues First'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default Step1Prerequisites;
