import React, { useState } from 'react';

function Step7Admin({ api, onComplete, onBack }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const validateEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const validatePassword = (password) => {
    const issues = [];
    if (password.length < 12) issues.push('At least 12 characters');
    if (!/[A-Z]/.test(password)) issues.push('One uppercase letter');
    if (!/[a-z]/.test(password)) issues.push('One lowercase letter');
    if (!/[0-9]/.test(password)) issues.push('One number');
    return issues;
  };

  const passwordIssues = validatePassword(password);
  const isValid = validateEmail(email) && passwordIssues.length === 0 && password === confirmPassword;

  const handleContinue = async () => {
    if (!isValid) return;

    setSaving(true);
    setError('');

    try {
      const result = await api.post('/api/wizard/step/7/admin-account', {
        email,
        password,
      });

      if (result.success) {
        onComplete({ adminEmail: email });
      } else {
        setError(result.error || 'Failed to create admin account');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-notely-dark mb-2">Admin Account</h2>
      <p className="text-gray-600 mb-6">
        Create the initial administrator account for managing Notely Platform.
      </p>

      <div className="card mb-6">
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Admin Email Address
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@example.com"
            className={`input-field ${email && !validateEmail(email) ? 'border-red-300' : ''}`}
          />
          {email && !validateEmail(email) && (
            <p className="text-red-600 text-sm mt-1">Please enter a valid email address</p>
          )}
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter a strong password"
            className="input-field"
          />

          <div className="mt-2 space-y-1">
            <p className="text-xs text-gray-500 font-medium">Password requirements:</p>
            {['At least 12 characters', 'One uppercase letter', 'One lowercase letter', 'One number'].map((req) => {
              const passed = !passwordIssues.includes(req);
              return (
                <div key={req} className="flex items-center gap-2 text-xs">
                  <span className={passed ? 'text-green-600' : 'text-gray-400'}>
                    {passed ? '✓' : '○'}
                  </span>
                  <span className={passed ? 'text-green-600' : 'text-gray-500'}>
                    {req}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Confirm Password
          </label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm your password"
            className={`input-field ${confirmPassword && password !== confirmPassword ? 'border-red-300' : ''}`}
          />
          {confirmPassword && password !== confirmPassword && (
            <p className="text-red-600 text-sm mt-1">Passwords do not match</p>
          )}
        </div>
      </div>

      <div className="card mb-6 bg-blue-50 border-blue-200">
        <h4 className="font-medium text-blue-800 mb-2">Admin Privileges</h4>
        <ul className="text-sm text-blue-700 space-y-1">
          <li>• Full access to all platform features</li>
          <li>• User management and role assignments</li>
          <li>• System configuration and monitoring</li>
          <li>• License management</li>
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
          disabled={!isValid || saving}
          className="btn-primary"
        >
          {saving ? 'Creating...' : 'Continue'}
        </button>
      </div>
    </div>
  );
}

export default Step7Admin;
