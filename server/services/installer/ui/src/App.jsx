import React, { useState, useEffect } from 'react';
import AuthScreen from './components/AuthScreen';
import WizardLayout from './components/WizardLayout';
import Step1Prerequisites from './pages/Step1Prerequisites';
import Step2DeploymentMode from './pages/Step2DeploymentMode';
import Step3Domain from './pages/Step3Domain';
import Step4SSL from './pages/Step4SSL';
import Step5Secrets from './pages/Step5Secrets';
import Step6OAuth from './pages/Step6OAuth';
import Step7Admin from './pages/Step7Admin';
import Step8Deploy from './pages/Step8Deploy';
import Step9Complete from './pages/Step9Complete';
import { useApi } from './hooks/useApi';

const STEPS = [
  { id: 1, name: 'Prerequisites', component: Step1Prerequisites },
  { id: 2, name: 'Deployment Mode', component: Step2DeploymentMode },
  { id: 3, name: 'Domain', component: Step3Domain },
  { id: 4, name: 'SSL', component: Step4SSL },
  { id: 5, name: 'Database', component: Step5Secrets },
  { id: 6, name: 'OAuth', component: Step6OAuth },
  { id: 7, name: 'Admin', component: Step7Admin },
  { id: 8, name: 'Deploy', component: Step8Deploy },
  { id: 9, name: 'Complete', component: Step9Complete },
];

function App() {
  const [sessionId, setSessionId] = useState(null);
  const [currentStep, setCurrentStep] = useState(1);
  const [completedSteps, setCompletedSteps] = useState([]);
  const [config, setConfig] = useState({});
  const api = useApi(sessionId);

  // Check for existing session
  useEffect(() => {
    const stored = sessionStorage.getItem('installerSessionId');
    if (stored) {
      setSessionId(stored);
    }
  }, []);

  // Load state from server when authenticated
  useEffect(() => {
    if (sessionId) {
      api.get('/api/state').then((data) => {
        if (data.currentStep) setCurrentStep(data.currentStep);
        if (data.completedSteps) setCompletedSteps(data.completedSteps);
        if (data.configuration) setConfig(data.configuration);
      }).catch(console.error);
    }
  }, [sessionId]);

  const handleAuth = (newSessionId) => {
    setSessionId(newSessionId);
    sessionStorage.setItem('installerSessionId', newSessionId);
  };

  const completeStep = (stepId, stepConfig = {}) => {
    if (!completedSteps.includes(stepId)) {
      setCompletedSteps([...completedSteps, stepId]);
    }
    setConfig({ ...config, ...stepConfig });

    // Save state to server
    api.put('/api/state', {
      currentStep: stepId + 1,
      configuration: { ...config, ...stepConfig },
    }).catch(console.error);

    // Move to next step
    if (stepId < 9) {
      setCurrentStep(stepId + 1);
    }
  };

  const goToStep = (stepId) => {
    // Can only go to completed steps or the next available step
    if (completedSteps.includes(stepId) || stepId === Math.max(...completedSteps, 0) + 1) {
      setCurrentStep(stepId);
    }
  };

  if (!sessionId) {
    return <AuthScreen onAuth={handleAuth} />;
  }

  const CurrentStepComponent = STEPS.find((s) => s.id === currentStep)?.component;

  return (
    <WizardLayout
      steps={STEPS}
      currentStep={currentStep}
      completedSteps={completedSteps}
      onStepClick={goToStep}
    >
      {CurrentStepComponent && (
        <CurrentStepComponent
          api={api}
          config={config}
          onComplete={(stepConfig) => completeStep(currentStep, stepConfig)}
          onBack={() => setCurrentStep(Math.max(1, currentStep - 1))}
        />
      )}
    </WizardLayout>
  );
}

export default App;
