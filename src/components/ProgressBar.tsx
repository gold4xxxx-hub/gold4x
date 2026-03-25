import React from 'react';

interface ProgressBarProps {
  percent: number;
}

const ProgressBar: React.FC<ProgressBarProps> = ({ percent }) => (
  <div>
    <div className="fx-progress">
      <div
        className="fx-progress__bar"
        style={{ width: `${percent}%` }}
      />
    </div>
  </div>
);

export default ProgressBar;
