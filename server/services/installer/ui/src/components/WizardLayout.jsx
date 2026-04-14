import React from 'react';

function WizardLayout({ steps, currentStep, completedSteps, onStepClick, children }) {
  return (
    <div className="wizard-container">
      {/* Header */}
      <header className="bg-notely-dark text-white py-4 px-6">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-notely-accent rounded-lg flex items-center justify-center">
              <span className="text-notely-dark font-bold text-lg">N</span>
            </div>
            <div>
              <h1 className="font-semibold">Notely Platform</h1>
              <p className="text-sm text-gray-300">Installation Wizard</p>
            </div>
          </div>

          <div className="text-sm text-gray-300">
            Step {currentStep} of {steps.length}
          </div>
        </div>
      </header>

      {/* Progress Bar */}
      <div className="bg-white border-b shadow-sm">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <div className="flex items-center gap-2 overflow-x-auto">
            {steps.map((step, index) => {
              const isCompleted = completedSteps.includes(step.id);
              const isCurrent = currentStep === step.id;
              const isClickable = isCompleted || step.id === Math.max(...completedSteps, 0) + 1;

              return (
                <React.Fragment key={step.id}>
                  <button
                    onClick={() => isClickable && onStepClick(step.id)}
                    disabled={!isClickable}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors whitespace-nowrap
                      ${isCurrent ? 'bg-notely-dark text-white' : ''}
                      ${isCompleted && !isCurrent ? 'text-notely-dark hover:bg-gray-100' : ''}
                      ${!isCompleted && !isCurrent ? 'text-gray-400' : ''}
                      ${isClickable ? 'cursor-pointer' : 'cursor-not-allowed'}
                    `}
                  >
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium
                      ${isCurrent ? 'bg-notely-accent text-notely-dark' : ''}
                      ${isCompleted && !isCurrent ? 'bg-green-500 text-white' : ''}
                      ${!isCompleted && !isCurrent ? 'bg-gray-200 text-gray-500' : ''}
                    `}>
                      {isCompleted && !isCurrent ? '✓' : step.id}
                    </span>
                    <span className="text-sm font-medium hidden sm:inline">{step.name}</span>
                  </button>

                  {index < steps.length - 1 && (
                    <div className={`w-8 h-0.5 ${isCompleted ? 'bg-green-500' : 'bg-gray-200'}`} />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 bg-gray-50 py-8">
        <div className="max-w-3xl mx-auto px-6">
          {children}
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t py-4 px-6">
        <div className="max-w-5xl mx-auto text-center text-sm text-gray-500">
          Notely Platform Installer v1.0.0
        </div>
      </footer>
    </div>
  );
}

export default WizardLayout;
