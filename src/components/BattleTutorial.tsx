import { useEffect } from 'react';
import { ArrowRight, BookOpen, RotateCcw } from 'lucide-react';
import type { GameState } from '../game';
import { advanceTutorial, getTutorialStep, restartTutorial, skipTutorial, updateTutorialProgress, type TutorialProgress } from '../lib/tutorial';
import './BattleTutorial.css';

export interface BattleTutorialProps {
  state: GameState;
  playerId: string;
  progress: TutorialProgress;
  onProgressChange: (progress: TutorialProgress) => void;
  resolving?: boolean;
}

export default function BattleTutorial({ state, playerId, progress, onProgressChange, resolving = false }: BattleTutorialProps) {
  const updated = updateTutorialProgress(state, playerId, progress);
  const step = getTutorialStep(state, playerId, updated);
  useEffect(() => { if (updated !== progress) onProgressChange(updated); }, [updated, progress, onProgressChange]);
  const active = progress.status === 'active';
  if (!active) return <div className="battle-tutorial-rest"><BookOpen size={13}/><span>{progress.status === 'completed' ? progress.attackConfirmed && progress.defenseConfirmed ? '基础教学已完成' : '教学已收起' : '教学已跳过'}</span><button onClick={() => onProgressChange(restartTutorial(state, playerId))}><RotateCcw size={12}/>重看教学</button></div>;
  return <aside className="battle-tutorial" data-active="true" data-target={resolving ? 'none' : step.target} aria-label="新手教学">
    <div className="tutorial-copy" aria-live="polite" aria-atomic="true"><div className="tutorial-heading"><span className="tutorial-number">{String(step.number).padStart(2, '0')}</span><strong>{step.title}</strong><small>/ 新手教学</small></div><p>{step.text}</p><small className="tutorial-hint">{step.hint}</small></div>
    <div className="tutorial-controls">{step.button && <button className="tutorial-next" disabled={resolving} onClick={() => onProgressChange(advanceTutorial(state, playerId, updated))}>{step.button}<ArrowRight size={13}/></button>}<button className="tutorial-skip" onClick={() => onProgressChange(skipTutorial(updated))}>跳过教学</button></div>
  </aside>;
}
