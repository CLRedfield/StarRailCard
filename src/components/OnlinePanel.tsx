import { useEffect, useState } from 'react';
import { ArrowRight, Check, Copy, Globe2, Link, LoaderCircle, Radio, RotateCcw, Shuffle, Users, Wifi, X, Swords } from 'lucide-react';
import { cardById, cards, diceById, prismaticDice, coopStages } from '../data';
import type { GameCommand, GameState } from '../game/types';
import type { OnlineSession, OnlineSnapshot, RoomMode } from '../net';
import { BROKER_ALTERNATIVES, isPartyRoomMode } from '../net';
import { getDraftPool, normalizeDraftLoadout } from '../lib/partyLobby';
import type { Profile } from '../lib/storage';
import CardView, { asset } from './CardView';
import { CharacterDetails, DiceDetails } from './LoadoutDetails';

export interface Loadout { cardId: string; prismaticId?: string; gild: number; draftSeed?: number; }
export default function OnlinePanel({ profile, online, getSession, onStart, onRestore, hasRestore, toast, loadout, setLoadout, broker, setBroker, onResume, coopChoice, setCoopChoice }: { profile: Profile; online: OnlineSnapshot<GameState> | null; getSession: () => OnlineSession<GameState, GameCommand>; onStart: () => void; onRestore: () => void; hasRestore: boolean; toast: (s: string) => void; loadout: Loadout; setLoadout: (l: Loadout) => void; broker: string; setBroker: (s: string) => void; onResume: () => void; coopChoice: string; setCoopChoice: (s: string) => void; }) {
  const [roomCode, setRoomCode] = useState(''), [mode, setMode] = useState<RoomMode>('duel'), [busy, setBusy] = useState(false);
  const room = online?.room;
  async function action(fn: () => Promise<unknown>) { setBusy(true); try { await fn(); } catch (e) { toast(e instanceof Error ? e.message : '连接失败，请重试'); } finally { setBusy(false); } }
  async function joinLegacyRoom() {
    const session = getSession(), joined = await session.joinRoom(roomCode.trim());
    if (isPartyRoomMode(joined.mode)) { await session.leave(); throw new Error('这是 4～8 人派对房，请从「多人派对」入口加入，或直接打开邀请链接。'); }
  }
  const mySeat = room?.players.find(p => p.id === online?.myId);
  const hostSeatLoadout = room?.players.find(p => p.seat === 0)?.loadout as Loadout | undefined;
  const activeDraftSeed = room ? (online?.isHost ? loadout.draftSeed : hostSeatLoadout?.draftSeed) : undefined;
  const isDraft = !!room && typeof activeDraftSeed === 'number' && activeDraftSeed > 0;
  const draftKey = isDraft ? `${room!.code}:${activeDraftSeed}` : '';
  const draftPlayerId = online?.myId || 'player';
  const draftPool = isDraft ? getDraftPool(draftKey, draftPlayerId, loadout.cardId) : null;

  useEffect(() => {
    if (!isDraft) return;
    const normalized = normalizeDraftLoadout(loadout, draftKey, draftPlayerId, loadout.gild);
    if (normalized.cardId !== loadout.cardId || normalized.prismaticId !== loadout.prismaticId) {
      const next: Loadout = { ...normalized, ...(online?.isHost && loadout.draftSeed ? { draftSeed: loadout.draftSeed } : {}) };
      setLoadout(next);
      if (room?.phase === 'lobby' && mySeat && !mySeat.ready) {
        void getSession().setReady(false, next).catch(() => {});
      }
    }
  }, [isDraft, draftKey, draftPlayerId, loadout, online?.isHost, room?.phase, mySeat, setLoadout, getSession]);

  function changeLoadout(next: Loadout) {
    const merged: Loadout = online?.isHost && loadout.draftSeed ? { ...next, draftSeed: loadout.draftSeed } : next;
    setLoadout(merged);
    if (room?.phase === 'lobby' && mySeat && !mySeat.ready) {
      void getSession().setReady(false, merged).catch(e => toast(`配置同步失败：${e instanceof Error ? e.message : '请重试'}`));
    }
  }
  function updateDraftRule(nextSeed: number | undefined) {
    if (!room || !online?.isHost || room.phase !== 'lobby') return;
    const base = nextSeed
      ? normalizeDraftLoadout(loadout, `${room.code}:${nextSeed}`, draftPlayerId, loadout.gild)
      : { cardId: loadout.cardId, prismaticId: loadout.prismaticId, gild: loadout.gild };
    const next: Loadout = nextSeed ? { ...base, draftSeed: nextSeed } : base;
    setLoadout(next);
    void action(() => getSession().setReady(false, next, { resetOthers: true }));
  }
  const chosenCard = cardById[loadout.cardId] || cards[0];
  const chosenDie = diceById[loadout.prismaticId || chosenCard.prismaticId || ''];
  const invite = () => { try { return getSession().inviteUrl(); } catch { return ''; } };
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast('邀请信息已复制'); } catch { toast(`房间号：${room?.code}`); } };
  return <section className="online-page page-enter"><div className="page-heading"><div><p className="eyebrow">PLAY TOGETHER · ROLL TOGETHER</p><h1>下一位对手，会是谁？</h1><p>邀请好友一决高下，或并肩挑战商业街。</p></div><span className={`connection-pill ${online?.connection === 'connected' ? 'connected' : ''}`}><Wifi size={15}/>{online?.connection === 'connected' ? '已连接' : '联机大厅'}</span></div>
    {!room || room.phase === 'closed' ? <div className="online-layout"><div className="online-intro"><div className="online-orbit"><Globe2 size={150} strokeWidth={.6}/><span className="orbit-spark one">✦</span><span className="orbit-spark two">✦</span></div><h2>银河之大，<br/>总有人等你上桌。</h2><p>所有角色卡与曜彩骰开放使用。<br/>选好搭档，把胜负交给策略与骰子。</p></div><div className="connection-form"><div className="segment"><button className={mode === 'duel' ? 'active' : ''} onClick={() => setMode('duel')}><Swords size={16}/>1v1 对决</button><button className={mode === 'coop' ? 'active' : ''} onClick={() => setMode('coop')}><Users size={16}/>双人共斗</button></div><label>公共服务器<select value={broker} onChange={e => setBroker(e.target.value)} disabled={busy}>{BROKER_ALTERNATIVES.map((b: string) => <option key={b} value={b}>{b.includes('broker-cn') ? 'EMQX · 备用线路' : b.includes('hivemq') ? 'HiveMQ · 备用线路' : 'EMQX · 默认线路'}</option>)}</select></label><div className="room-actions"><button className="primary" disabled={busy} onClick={() => action(() => getSession().createRoom({ mode }))}><Users size={17}/>创建好友房间<ArrowRight size={17}/></button><button className="secondary" disabled={busy} onClick={() => action(() => getSession().quickMatch(mode))}><Radio size={17}/>快速匹配</button></div><div className="or-divider"><span/>加入已有房间<span/></div><label>房间码或邀请链接<input value={roomCode} onChange={e => setRoomCode(e.target.value)} placeholder="输入 6 位房间码" maxLength={1000}/></label><button className="secondary full" disabled={busy || !roomCode.trim()} onClick={() => action(joinLegacyRoom)}>加入房间 <ArrowRight size={17}/></button>{hasRestore && <button className="text-button" onClick={onRestore}>恢复上次的联机房间</button>}{busy && <p className="connecting"><LoaderCircle className="spin" size={17}/>正在连接公共服务器…</p>}<small className="muted">双方请刷新到最新版后重新建房；养成进度会保留。切换线路需重新加入房间。</small></div></div> : <div className="room-view"><div className="room-heading"><div><span>房间号码</span><strong>{room.code}</strong><button className="icon-button" title="复制房间号" onClick={() => copy(room.code)}><Copy size={17}/></button></div><span>{room.mode === 'coop' ? '2v1 双人共斗' : '1v1 经典对决'}</span><button className="secondary" onClick={() => copy(invite())}><Link size={15}/>复制邀请链接</button><button className="icon-button" title="离开房间" onClick={() => action(() => getSession().leave())}><X size={20}/></button></div><div className="room-seats">{[0, 1].map(seat => {
      const p = room.players.find(x => x.seat === seat), isMe = p?.id === online?.myId;
      const rawChosen = (isMe ? loadout : p?.loadout) as Loadout | undefined;
      const chosen = isDraft && p ? normalizeDraftLoadout(rawChosen, draftKey, p.id, rawChosen?.gild || 0) : rawChosen;
      const card = cardById[chosen?.cardId || '264014'];
      return <div className={`room-seat ${p ? '' : 'empty'}`} key={seat}>{p ? <><span className="seat-label">{seat === 0 ? '房主' : '玩家'}{isMe ? ' · 你' : ''}</span><CardView card={card} gild={chosen?.gild || 0}/><h3>{p.name}</h3><span className={`ready-label ${p.ready ? 'yes' : ''}`}>{p.ready ? <><Check size={14}/>已准备</> : '配置卡牌中'}</span></> : <><Users size={58} strokeWidth={1}/><h3>等待另一名开拓者</h3><p>分享房间码或邀请链接</p></>}</div>;
    })}</div>
    {online?.isHost && room.phase === 'lobby' && (
      <div className="party-draft-toggle-row" style={{ marginBottom: 14 }}>
        <label className="toggle-row party-draft-check">
          <span><Shuffle size={14}/>三选一盲盒轮抽（双方各自从 3 张角色 + 3 枚曜彩骰中盲选）</span>
          <input
            type="checkbox"
            disabled={busy}
            checked={isDraft}
            onChange={e => updateDraftRule(e.target.checked ? (crypto.getRandomValues(new Uint32Array(1))[0] % 999999) + 1 : undefined)}
          />
        </label>
        {isDraft && (
          <button type="button" className="secondary compact party-draft-reroll" disabled={busy} onClick={() => updateDraftRule((crypto.getRandomValues(new Uint32Array(1))[0] % 999999) + 1)}>
            <RotateCcw size={13}/>换一批
          </button>
        )}
      </div>
    )}
    {!online?.isHost && isDraft && <p className="loadout-preview-note" style={{ marginBottom: 12 }}>🎲 房主已开启「三选一盲盒轮抽」：请从下方专属盲盒池中选择角色与曜彩骰。</p>}
    {isDraft && draftPool ? (
      <div className="party-draft-box" style={{ marginBottom: 16 }}>
        <div className="party-draft-label"><span>🎲 盲盒角色（三选一）</span><small>每人独立候选池</small></div>
        <div className="party-draft-cards">
          {draftPool.cardIds.map(cid => {
            const c = cardById[cid];
            if (!c) return null;
            return (
              <button
                key={cid}
                type="button"
                disabled={mySeat?.ready || room.phase !== 'lobby'}
                className={`party-draft-card ${loadout.cardId === cid ? 'active' : ''}`}
                onClick={() => {
                  const nextPool = getDraftPool(draftKey, draftPlayerId, cid);
                  changeLoadout({ cardId: cid, prismaticId: nextPool.prismaticIds[0], gild: loadout.gild });
                }}
              >
                <img src={asset(c.image)} alt={c.name}/>
                <div><strong>{c.name}</strong><small>HP {c.hp} · 攻{c.attack || '∞'} 防{c.defense}</small></div>
              </button>
            );
          })}
        </div>
        {draftPool.prismaticIds.length > 0 && (
          <>
            <div className="party-draft-label"><span>✦ 盲盒曜彩骰（三选一）</span><small>专属骰 + 2 奇遇骰</small></div>
            <div className="party-draft-dice">
              {draftPool.prismaticIds.map((did, idx) => {
                const d = diceById[did];
                if (!d) return null;
                const activeDie = (loadout.prismaticId || draftPool.prismaticIds[0]) === did;
                return (
                  <button
                    key={did}
                    type="button"
                    disabled={mySeat?.ready || room.phase !== 'lobby'}
                    className={`party-draft-die ${activeDie ? 'active' : ''}`}
                    onClick={() => changeLoadout({ ...loadout, prismaticId: did })}
                  >
                    {d.image && <img src={asset(d.image)} alt=""/>}
                    <div><strong>{d.name}</strong><small>{idx === 0 ? '角色默认' : '盲盒奇遇'}</small></div>
                  </button>
                );
              })}
            </div>
          </>
        )}
        <label style={{ maxWidth: 200 }}>镀闪<select value={loadout.gild} disabled={mySeat?.ready || room.phase !== 'lobby'} onChange={e => changeLoadout({ ...loadout, gild: Number(e.target.value) })}><option value={0}>普通</option><option value={1}>金色</option><option value={2}>曜彩</option></select></label>
      </div>
    ) : (
      <div className="room-loadout"><label>出战角色<select value={loadout.cardId} disabled={mySeat?.ready || room.phase !== 'lobby'} onChange={e => { const card = cardById[e.target.value]; changeLoadout({ cardId: card.id, prismaticId: card.prismaticId || undefined, gild: loadout.gild }); }}>{cards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>曜彩骰<select value={loadout.prismaticId || chosenCard.prismaticId || ''} disabled={mySeat?.ready || room.phase !== 'lobby' || !cardById[loadout.cardId]?.prismaticId} onChange={e => changeLoadout({ ...loadout, prismaticId: e.target.value })}><option value={chosenCard.prismaticId || ''}>角色默认{chosenCard.prismaticId ? ` · ${diceById[chosenCard.prismaticId]?.name || ''}` : ' · 无曜彩骰'}</option>{prismaticDice.filter(d => d.id !== chosenCard.prismaticId).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label><label>镀闪<select value={loadout.gild} disabled={mySeat?.ready || room.phase !== 'lobby'} onChange={e => changeLoadout({ ...loadout, gild: Number(e.target.value) })}><option value={0}>普通</option><option value={1}>金色</option><option value={2}>曜彩</option></select></label></div>
    )}<div className="room-inspectors"><CharacterDetails key={chosenCard.id} card={chosenCard}/>{chosenDie ? <DiceDetails key={chosenDie.id} die={chosenDie} card={chosenCard} caption="联机出战配置"/> : <p className="loadout-preview-note">此角色不能使用曜彩骰。</p>}</div><div className="room-footer">{room.mode === 'coop' && online?.isHost && room.phase === 'lobby' && <label>共斗对手<select value={coopChoice} onChange={e => setCoopChoice(e.target.value)}>{coopStages.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}{room.phase !== 'lobby' && <button className="primary" onClick={onResume}>返回对局 <ArrowRight size={16}/></button>}<p>{online?.error || (room.players.length < 2 ? '等待好友加入，双方准备后即可开始。' : '双方确认出战配置后，由房主开始对局。')}</p><button className="secondary" disabled={busy || !mySeat || room.phase !== 'lobby'} onClick={() => action(() => getSession().setReady(!mySeat?.ready, loadout))}>{mySeat?.ready ? '取消准备' : '准备就绪'}<Check size={16}/></button>{online?.isHost && <button className="primary" disabled={room.phase !== 'lobby' || room.players.length < 2 || room.players.some(p => !p.ready)} onClick={onStart}>开始对局 <ArrowRight size={17}/></button>}</div></div>}
    {(!room || room.phase === 'closed') && online?.error && <div className="inline-error">{online.error}</div>}
  </section>;
}
