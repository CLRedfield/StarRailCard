import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { GameState, PlayerState } from '../game/types';
import { cardById } from '../data';
import { asset } from './CardView';
import './DefeatEffects.css';

interface Props {
  state: GameState;
  playerId: string;
  defeats: Array<{ player: PlayerState; kind: 'defeat' | 'revive' | 'boss-phase' }>;
  reducedMotion?: boolean;
}

interface CardAnchor { x: number; y: number; width: number; height: number; captionY: number }

// The reference uses a block-letter KO with a red extrusion, rather than a font.
const KO_PIXELS = ['1100110011110', '1101100110011', '1111000110011', '1110000110011', '1111000110011', '1101100110011', '1100110011110'];
const KO_PATH = KO_PIXELS.flatMap((row, y) => [...row].flatMap((pixel, x) => pixel === '1' ? [`M${x * 10} ${y * 10}h10v10h-10z`] : [])).join('');

/** Mounted only during the presentation clock's defeat phase; the engine owns outcomes. */
export default function DefeatEffects({ state, playerId, defeats, reducedMotion = false }: Props) {
  const mount = useRef<HTMLDivElement>(null);
  const [anchors, setAnchors] = useState<Record<string, CardAnchor>>({});
  const ownSide = state.players.find(player => player.id === playerId)?.side ?? 0;
  useLayoutEffect(() => {
    const layer = mount.current, board = layer?.parentElement;
    if (!layer || !board) return;
    const measure = () => {
      const bounds = layer.getBoundingClientRect();
      const huds = Array.from(board.querySelectorAll<HTMLElement>('[data-battle-player]'));
      const cards = Array.from(board.querySelectorAll<HTMLElement>('[data-battle-card]'));
      setAnchors(Object.fromEntries(defeats.map(({ player }) => {
        const hud = huds.find(element => element.dataset.battlePlayer === player.id);
        const card = cards.find(element => element.dataset.battleCard === player.id) || hud?.querySelector('.hud-portrait') || hud;
        const r = card?.getBoundingClientRect();
        const x = r ? r.left + r.width / 2 - bounds.left : bounds.width / 2;
        const y = r ? r.top + r.height / 2 - bounds.top : bounds.height * (player.side === ownSide ? .82 : .18);
        const width = r?.width || 58, height = r?.height || 75;
        // Keep the large KO inside the table, including short landscape screens.
        const captionY = Math.max(76, Math.min(bounds.height - 70, y + (player.side === ownSide ? -height * .55 : height * .55)));
        return [player.id, { x, y, width, height, captionY }];
      })));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(board);
    return () => observer.disconnect();
  }, [defeats, ownSide]);

  return <div ref={mount} className={`defeat-effects ${reducedMotion ? 'reduced' : ''}`} role="status" aria-label={defeats.map(({ player, kind }) => `${cardById[player.cardId]?.name || player.name}${kind === 'revive' ? '倒下，准备复起' : kind === 'boss-phase' ? '本阶段击破' : '被击败'}`).join('；')}>
    <div className="defeat-focus" aria-hidden="true"/>
    {defeats.map(({ player, kind }) => {
      const anchor = anchors[player.id];
      if (!anchor) return null;
      const card = cardById[player.cardId];
      const style = { '--defeat-x': `${anchor.x}px`, '--defeat-y': `${anchor.y}px`, '--defeat-label-y': `${anchor.captionY}px`, '--defeat-w': `${anchor.width}px`, '--defeat-h': `${anchor.height}px` } as CSSProperties;
      return <div className={`defeat-fighter ${kind}`} key={player.id} style={style} aria-hidden="true">
        {card?.image && <div className="defeat-card"><img src={asset(card.image)} alt="" draggable={false}/><i/></div>}
        <div className="defeat-burst"><i className="defeat-impact-flash"/><i className="defeat-impact-ring"/>
          {Array.from({ length: 20 }, (_, index) => <i className={`defeat-ray ${index % 3 === 0 ? 'white' : ''}`} key={index} style={{ '--ray-angle': `${index * 18 + (index % 3) * 3}deg`, '--ray-length': `${95 + index % 5 * 24}px`, '--ray-delay': `${index % 4 * 18}ms` } as CSSProperties}/>)}
        </div>
        <div className="defeat-cubes">
          {Array.from({ length: 30 }, (_, index) => {
            const angle = index * 2.399963;
            const distance = 75 + index % 6 * 27;
            return <svg className="defeat-cube" key={index} viewBox="0 0 24 28" style={{ '--cube-x': `${Math.cos(angle) * distance}px`, '--cube-y': `${Math.sin(angle) * distance * .72}px`, '--cube-size': `${9 + index % 4 * 4}px`, '--cube-rotate': `${index * 29 - 160}deg`, '--cube-delay': `${index % 5 * 25}ms` } as CSSProperties}>
              <path className="cube-top" d="M1 7 12 1 23 7 12 14Z"/><path className="cube-left" d="M1 7 12 14 12 27 1 20Z"/><path className="cube-right" d="M12 14 23 7 23 20 12 27Z"/>
            </svg>;
          })}
          {Array.from({ length: 16 }, (_, index) => <i className="defeat-spark" key={`spark-${index}`} style={{ '--spark-x': `${Math.cos(index * 2.4) * (70 + index % 5 * 31)}px`, '--spark-y': `${Math.sin(index * 2.4) * (60 + index % 4 * 29)}px`, '--spark-delay': `${index % 6 * 35}ms` } as CSSProperties}/>)}
        </div>
        <div className="defeat-ko">
          <svg viewBox="-5 -8 150 88" aria-label="KO"><path className="ko-depth" d={KO_PATH} transform="translate(5,-5)"/><path className="ko-shadow" d={KO_PATH} transform="translate(2,4)"/><path className="ko-face" d={KO_PATH}/></svg>
          {kind !== 'defeat' && <small>{kind === 'revive' ? '消耗共享生命 · 准备复起' : '阶段击破'}</small>}
        </div>
      </div>;
    })}
  </div>;
}
