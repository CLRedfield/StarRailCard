import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Bot, Check, Copy, Crown, Globe2, LoaderCircle, Play, RotateCcw, Users, Wifi, X } from 'lucide-react';
import { cards, cardById, diceById, prismaticDice } from '../data';
import { createPartyMatch, applyPartyCommand, choosePartyAiCommand } from '../game/party';
import type { PartyCommand, PartyMode, PartyState } from '../game/partyTypes';
import { OnlineSession, BROKER_ALTERNATIVES, DEFAULT_BROKER } from '../net';
import type { OnlineSnapshot, SessionCheckpoint } from '../net';
import { isPartyState, partyCommandScope, partyStateCodec, reducePartyCommand } from '../net/partySync';
import { readSave, writeSave } from '../lib/storage';
import type { Profile } from '../lib/storage';
import { PARTY_MODES, createPartyRoster, normalizePartyLoadout, validPartyCount } from '../lib/partyLobby';
import type { PartyLoadout, PartyLobbySettings } from '../lib/partyLobby';
import CardView, { asset } from './CardView';
import { CharacterDetails, DiceDetails } from './LoadoutDetails';
import PartyBattle from './PartyBattle';
import './PartyHub.css';

const partyOnlineKey = (() => {
  try {
    let id = sessionStorage.getItem('starrailcard-tab');
    if (!id) { id = crypto.randomUUID(); sessionStorage.setItem('starrailcard-tab', id); }
    return `party-online:${id}`;
  } catch { return `party-online:${crypto.randomUUID()}`; }
})();
const initialSettings: PartyLobbySettings = { count: 4, maxRounds: 8, bossId: '' };
interface LocalParty { state: PartyState; playerId: string; }
interface Props { profile: Profile; active: boolean; onActivate: () => void; toast: (message: string) => void; onBattleViewChange?: (inBattle: boolean) => void; }

export default function PartyHub({ profile, active, onActivate, toast, onBattleViewChange }: Props) {
  const [mode, setMode] = useState<PartyMode>('treasure');
  const [settings, setSettings] = useState<PartyLobbySettings>(initialSettings);
  const [loadout, setLoadout] = useState<PartyLoadout>(() => normalizePartyLoadout({ cardId: profile.selectedCard, prismaticId: profile.selectedDice, gild: profile.gild[profile.selectedCard] || 0 }));
  const [broker, setBroker] = useState(DEFAULT_BROKER), [roomCode, setRoomCode] = useState('');
  const [online, setOnline] = useState<OnlineSnapshot<PartyState> | null>(null);
  const [checkpoint, setCheckpoint] = useState<SessionCheckpoint<PartyState> | null>(null);
  const [local, setLocal] = useState<LocalParty | null>(null), localRef = useRef<LocalParty | null>(null);
  const [view, setView] = useState<'lobby' | 'battle'>('lobby');
  const [connecting, setConnecting] = useState(false), [pending, setPending] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const sessionRef = useRef<OnlineSession<PartyState, PartyCommand> | null>(null);
  const unsubscribe = useRef<(() => void) | undefined>(undefined), inFlight = useRef(new Set<string>());
  const inviteHandled = useRef(false);
  const callbacks = useRef({ toast, onActivate, name: profile.name });
  callbacks.current = { toast, onActivate, name: profile.name };

  useEffect(() => {
    let mounted = true;
    void Promise.all([readSave<LocalParty>('party-match'), readSave<SessionCheckpoint<PartyState>>(partyOnlineKey)]).then(([saved, savedOnline]) => {
      if (!mounted) return;
      if (saved && isPartyState(saved.state) && saved.state.players.some(p => p.id === saved.playerId)) {
        const restored = { ...saved, state: { ...saved.state, swapPools: saved.state.swapPools ?? {} } };
        setLocal(restored); localRef.current = restored;
      }
      if (savedOnline?.protocol === 2 && savedOnline.room?.phase !== 'closed' && (!savedOnline.game || isPartyState(savedOnline.game))) {
        const normalized = savedOnline.game ? { ...savedOnline, game: { ...savedOnline.game, swapPools: savedOnline.game.swapPools ?? {} } } : savedOnline;
        setCheckpoint(normalized); setBroker(savedOnline.broker);
      }
      setLoaded(true);
    }).catch(() => { if (mounted) setLoaded(true); });
    return () => { mounted = false; };
  }, []);
  useEffect(() => () => { unsubscribe.current?.(); sessionRef.current?.destroy(); }, []);

  const saveLocal = useCallback((next: LocalParty) => { localRef.current = next; setLocal(next); void writeSave('party-match', next); }, []);
  const getSession = useCallback((selectedBroker?: string) => {
    const targetBroker = selectedBroker || broker;
    if (sessionRef.current && !sessionRef.current.getSnapshot().room && sessionRef.current.broker !== targetBroker) {
      unsubscribe.current?.(); sessionRef.current.destroy(); sessionRef.current = null;
    }
    if (!sessionRef.current) {
      const s = new OnlineSession<PartyState, PartyCommand>({
        name: callbacks.current.name, broker: targetBroker, reduce: reducePartyCommand,
        commandScope: partyCommandScope, stateCodec: partyStateCodec, validateState: isPartyState,
        persist: async value => { setCheckpoint(value); await writeSave(partyOnlineKey, value); },
      });
      sessionRef.current = s;
      let previous = s.getSnapshot();
      unsubscribe.current = s.subscribe(() => {
        const snapshot = s.getSnapshot(); setOnline(snapshot);
        if (snapshot.room && PARTY_MODES.some(m => m.id === snapshot.room!.mode)) setMode(snapshot.room.mode as PartyMode);
        if (snapshot.room && snapshot.room.epoch !== previous.room?.epoch) {
          const own = snapshot.room.players.find(p => p.id === snapshot.myId);
          if (own?.loadout) setLoadout(normalizePartyLoadout(own.loadout));
          const host = snapshot.room.players.find(p => p.seat === 0)?.loadout as { partySettings?: PartyLobbySettings } | undefined;
          if (host?.partySettings && snapshot.isHost) setSettings({ ...host.partySettings, count: snapshot.room.capacity || host.partySettings.count });
          else setSettings(current => ({ ...current, count: snapshot.room!.capacity || 4 }));
        }
        if (snapshot.game && (!previous.game || previous.matchId !== snapshot.matchId) && ['playing', 'paused'].includes(snapshot.status)) { setView('battle'); callbacks.current.onActivate(); }
        if (snapshot.status === 'lobby' && previous.status !== 'lobby') setView('lobby');
        if (!snapshot.isHost && snapshot.room?.phase === 'lobby' && previous.room?.phase === 'lobby') {
          const prevMe = previous.room.players.find(p => p.id === snapshot.myId);
          const nextMe = snapshot.room.players.find(p => p.id === snapshot.myId);
          if (prevMe?.ready && nextMe && !nextMe.ready) callbacks.current.toast('房主调整了规则，请重新确认准备状态。');
        }
        if (snapshot.status === 'closed' && previous.status !== 'closed') { setView('lobby'); setSettings(current => ({ ...current, bossId: current.bossId === 'ai' ? 'ai' : '' })); callbacks.current.toast(snapshot.error || '多人房间已关闭。'); }
        if (previous.game && !snapshot.game) setView('lobby');
        previous = snapshot;
      });
      setOnline(s.getSnapshot());
    }
    return sessionRef.current;
  }, [broker]);

  useEffect(() => {
    if (!loaded || inviteHandled.current) return;
    const params = new URLSearchParams(location.search);
    if (params.has('room') && params.has('party')) {
      inviteHandled.current = true;
      const requested = params.get('party');
      if (PARTY_MODES.some(m => m.id === requested)) setMode(requested as PartyMode);
      setConnecting(true); callbacks.current.onActivate();
      void getSession(params.get('broker') || undefined).joinRoom(location.href).catch(e => callbacks.current.toast(e.message)).finally(() => setConnecting(false));
    }
  }, [loaded, getSession]);

  const room = online?.room && online.room.phase !== 'closed' ? online.room : null;
  const isOnlineGame = !!online?.game && ['playing', 'paused'].includes(online.status);
  const game = isOnlineGame ? online!.game! : local?.state;
  const inPartyBattle = active && view === 'battle' && !!game;
  useEffect(() => {
    onBattleViewChange?.(inPartyBattle);
    return () => onBattleViewChange?.(false);
  }, [inPartyBattle, onBattleViewChange]);
  const myId = isOnlineGame ? online!.myId : local?.playerId || 'party-player';
  const mySeat = room?.players.find(p => p.id === online?.myId);
  const hostLoadout = room?.players.find(p => p.seat === 0)?.loadout as (PartyLoadout & { partySettings?: PartyLobbySettings }) | undefined;
  const announcedSettings = !online?.isHost && hostLoadout?.partySettings ? hostLoadout.partySettings : settings;
  const chosenMode = PARTY_MODES.find(m => m.id === (room?.mode || mode)) || PARTY_MODES[0];
  const chosenCard = cardById[loadout.cardId] || cards[0];
  const chosenDice = diceById[loadout.prismaticId || ''];

  useEffect(() => {
    if (!room || !online?.isHost || room.phase !== 'lobby' || room.mode !== 'overlord' || !settings.bossId) return;
    const invalid = settings.bossId === 'ai' ? room.players.length >= settings.count : !room.players.some(p => p.id === settings.bossId);
    if (!invalid) return;
    const next = { ...settings, bossId: '' }; setSettings(next);
    void getSession().setReady(false, { ...loadout, partySettings: next }).catch(e => callbacks.current.toast(e.message));
  }, [room, online?.isHost, settings, loadout, getSession]);

  const send = useCallback((command: PartyCommand) => {
    const s = sessionRef.current;
    if (s?.getSnapshot().game && ['playing', 'paused'].includes(s.getSnapshot().status)) {
      if (inFlight.current.has(command.playerId)) return;
      inFlight.current.add(command.playerId); setPending([...inFlight.current]);
      void s.sendCommand(command).catch(e => callbacks.current.toast(e.message)).finally(() => { inFlight.current.delete(command.playerId); setPending([...inFlight.current]); });
      return;
    }
    const current = localRef.current; if (!current) return;
    const result = applyPartyCommand(current.state, command);
    if (result.error) { callbacks.current.toast(result.error); return; }
    saveLocal({ ...current, state: result.state });
  }, [saveLocal]);

  useEffect(() => {
    if ((!isOnlineGame && (!active || view !== 'battle')) || !game || game.phase === 'finished' || online?.status === 'paused' || (isOnlineGame && !online?.isHost)) return;
    // At most one host AI command is in flight. Each command is chosen from the latest shared state.
    if (game.players.some(p => p.isAI && pending.includes(p.id))) return;
    let command: PartyCommand | null = null;
    for (const bot of game.players.filter(p => p.isAI)) {
      const candidate = choosePartyAiCommand(game, bot.id);
      // Keep AI dice available for trades until the humans have finished planning.
      if (candidate?.type === 'confirm' && game.players.some(p => !p.isAI && !p.confirmed)) {
        if (candidate.diceIds && JSON.stringify(candidate.diceIds) !== JSON.stringify(bot.selectedIds)) {
          command = { type: 'select', playerId: bot.id, diceIds: candidate.diceIds }; break;
        }
        continue;
      }
      if (candidate) { command = candidate; break; }
    }
    if (!command) return;
    const t = setTimeout(() => send(command!), profile.settings.reducedMotion ? 50 : 160);
    return () => clearTimeout(t);
  }, [active, view, game, online?.status, online?.isHost, isOnlineGame, pending, send, profile.settings.reducedMotion]);

  async function action(work: () => Promise<unknown>) {
    setConnecting(true);
    try { await work(); } catch (e) { toast(e instanceof Error ? e.message : '操作未完成，请重试。'); }
    finally { setConnecting(false); }
  }
  function changeMode(next: PartyMode) { setMode(next); setSettings(s => ({ ...s, count: next === 'duos' && s.count % 2 ? s.count + 1 : s.count })); }
  function changeLoadout(next: PartyLoadout) {
    setLoadout(next);
    if (room?.phase === 'lobby' && mySeat && !mySeat.ready) {
      void getSession().setReady(false, { ...next, ...(online?.isHost ? { partySettings: settings } : {}) })
        .catch(e => callbacks.current.toast(`配置同步失败：${e instanceof Error ? e.message : '请重试'}`));
    }
  }
  function changeSettings(next: PartyLobbySettings) {
    setSettings(next);
    if (room && online?.isHost && room.phase === 'lobby') void action(() => getSession().setReady(false, { ...loadout, partySettings: next }, { resetOthers: true }));
  }
  function startLocal() {
    try {
      const players = createPartyRoster(mode, [{ id: 'party-player', name: profile.name, loadout }], settings.count, settings.bossId === 'ai' ? 'ai' : 'party-player', crypto.getRandomValues(new Uint32Array(1))[0]);
      const state = createPartyMatch({ mode, players, maxRounds: settings.maxRounds }, crypto.getRandomValues(new Uint32Array(1))[0]);
      saveLocal({ state, playerId: 'party-player' }); setView('battle');
    } catch (e) { toast(e instanceof Error ? e.message : '无法开始练习。'); }
  }
  async function startOnline() {
    const s = getSession(), current = s.getSnapshot().room;
    if (!current) return;
    const mode = current.mode as PartyMode;
    const ordered = [...current.players].sort((a, b) => a.seat - b.seat);
    const players = createPartyRoster(mode, ordered, settings.count, settings.bossId || ordered[0].id, crypto.getRandomValues(new Uint32Array(1))[0]);
    await s.startMatch(createPartyMatch({ mode, players, maxRounds: settings.maxRounds }, crypto.getRandomValues(new Uint32Array(1))[0]));
    setView('battle');
  }
  async function copyInvite() {
    const url = new URL(getSession().inviteUrl()); url.searchParams.set('party', room!.mode);
    try { await navigator.clipboard.writeText(url.toString()); toast('多人邀请链接已复制。'); }
    catch { toast(`房间号：${room?.code}；请在多人派对中加入。`); }
  }
  function exitBattle() {
    setView('lobby');
    if (isOnlineGame && online?.isHost && game?.phase === 'finished' && (room?.players.length ?? 0) <= 1) void action(() => getSession().returnToLobby());
  }

  return <div hidden={!active} className="party-root">
    {view === 'battle' && game ? <>
      {isOnlineGame && online?.status === 'paused' && <div className="party-connection-banner" role="status"><Wifi size={18}/>{online.pauseReason || '连接中断，正在等待所有玩家恢复。'}</div>}
      <PartyBattle key={isOnlineGame ? `${online?.matchId}:${online?.recoveryRevision}` : 'local-party'} state={game} playerId={myId} onCommand={send} onExit={exitBattle} busy={pending.includes(myId) || (isOnlineGame && online?.status === 'paused')} soundVolume={profile.settings.effects} reducedMotion={profile.settings.reducedMotion} lowQuality={profile.settings.quality === 'low'}/>
    </> : <section className="party-hub page-enter">
      <div className="party-hub-heading"><div><p className="eyebrow">GALAXY PARTY · 4–8 PLAYERS</p><h1>一起上桌，各显身手。</h1><p>四种玩法，同一套角色。邀请朋友，或先和 AI 试试配合。</p></div><span className="party-hub-badge"><Users size={18}/>{room ? `${room.players.length} 人已入座` : '全角色开放'}</span></div>
      {!room ? <>
        <div className="party-mode-menu" role="group" aria-label="选择多人玩法">{PARTY_MODES.map((m, i) => <button key={m.id} className={mode === m.id ? 'active' : ''} aria-pressed={mode === m.id} onClick={() => changeMode(m.id)}><span>0{i + 1}</span><strong>{m.name}</strong><small>{m.players}</small></button>)}</div>
        <div className="party-hub-layout">
          <div className="party-mode-feature"><div className="party-mode-copy"><span className="eyebrow">{chosenMode.subtitle}</span><h2>{chosenMode.name}</h2><p>{chosenMode.description}</p><ol>{chosenMode.rules.map(rule => <li key={rule}>{rule}</li>)}</ol></div><img className="party-mode-art" src={asset(cardById[chosenMode.image]?.image || chosenCard.image)} alt=""/></div>
          <div className="party-setup"><div className="party-form-title"><Bot size={18}/><h3>配置这张牌桌</h3></div>
            {renderSettings(false)}
            {renderLoadout(false)}
            <button className="primary full" disabled={!loaded || connecting || isOnlineGame} onClick={startLocal}><Play size={17}/>和 AI 开始练习<ArrowRight size={16}/></button>
            {local && <button className="text-button" onClick={() => setView('battle')}><RotateCcw size={14}/>{local.state.phase === 'finished' ? '查看上局结果' : `继续上次的${PARTY_MODES.find(m => m.id === local.state.mode)?.name || '对局'} · 第 ${local.state.round} 轮`}</button>}
          </div>
        </div>
        <div className="party-connect"><div><Globe2 size={26}/><h3>朋友到齐，开一桌。</h3><p>同一房间最多 8 人，空位由 AI 补齐。</p></div><div className="party-connect-fields"><label>公共服务器<select value={broker} disabled={connecting} onChange={e => setBroker(e.target.value)}>{BROKER_ALTERNATIVES.map(b => <option key={b} value={b}>{b.includes('broker-cn') ? 'EMQX · 备用' : b.includes('hivemq') ? 'HiveMQ · 备用' : 'EMQX · 默认'}</option>)}</select></label><button className="primary" disabled={connecting} onClick={() => action(async () => { const s = getSession(); await s.createRoom({ mode, capacity: settings.count }); await s.setReady(false, { ...loadout, partySettings: settings }); })}><Users size={16}/>创建好友房</button><label>房间号或邀请链接<input value={roomCode} maxLength={1000} placeholder="输入房间号或粘贴链接" onChange={e => setRoomCode(e.target.value)}/></label><button className="secondary" disabled={connecting || !roomCode.trim()} onClick={() => action(async () => { const s = getSession(); const joined = await s.joinRoom(roomCode.trim()); if (!PARTY_MODES.some(m => m.id === joined.mode)) { await s.leave(); throw new Error('这是经典或双人共斗房，请从「联机」入口加入。'); } })}>加入房间<ArrowRight size={16}/></button></div></div>
        {checkpoint && !room && <button className="text-button" disabled={connecting} onClick={() => action(() => getSession(checkpoint.broker).restore(checkpoint))}>恢复上次的多人房间</button>}
      </> : <>
        <div className="party-room-heading"><div><small>{chosenMode.name} · 房间号</small><strong>{room.code}</strong></div><button className="secondary" onClick={copyInvite}><Copy size={16}/>复制邀请链接</button><button className="text-button" disabled={connecting} onClick={() => action(() => getSession().leave())}><X size={16}/>离开房间</button></div>
        <div className="party-seat-list">{Array.from({ length: room.capacity || 8 }, (_, index) => {
          const orderedPlayers = room.players.slice().sort((a, b) => a.seat - b.seat);
          const player = orderedPlayers[index];
          const chosen = normalizePartyLoadout(player?.id === online?.myId ? loadout : player?.loadout);
          const effectiveBossId = room.mode === 'overlord' ? (announcedSettings.bossId || room.hostId) : '';
          const isPlayerBoss = !!player && room.mode === 'overlord' && effectiveBossId === player.id;
          const isAiBossSeat = !player && room.mode === 'overlord' && effectiveBossId === 'ai' && index === orderedPlayers.length;
          return <div className={`party-seat ${player ? '' : 'is-empty'} ${isAiBossSeat ? 'is-ai-boss' : ''}`} key={index}>{player ? <><img src={asset(cardById[chosen.cardId].image)} alt={cardById[chosen.cardId].name}/><div><strong>{player.name}{player.id === online?.myId ? ' · 你' : ''}</strong><span>{cardById[chosen.cardId].name}</span><small>{room.mode === 'duos' ? `第 ${Math.floor(index / 2) + 1} 队` : isPlayerBoss ? '本局首领' : player.seat === 0 ? '房主' : room.mode === 'overlord' ? '讨伐队员' : '开拓者'}</small></div><span className={player.ready ? 'party-seat-ready' : 'muted'}>{player.ready ? <><Check size={13}/>就绪</> : '准备中'}</span></> : <>{isAiBossSeat ? <Crown size={25}/> : <Bot size={25}/>}<div><strong>{isAiBossSeat ? 'AI 首领' : '等待好友'}</strong><small>{isAiBossSeat ? '开局由 AI 担任首领' : '开局时 AI 补位'}</small></div></>}</div>;
        })}</div>
        <div className="party-room-config"><div className="party-setup">{renderLoadout(!!mySeat?.ready || room.phase !== 'lobby')}{online?.isHost ? renderSettings(room.phase !== 'lobby') : <p className="party-room-note">{announcedSettings.count} 个席位 · 最多 {announcedSettings.maxRounds} 轮<br/>房主确认规则后，准备就绪即可上桌。</p>}</div><aside className="party-character-preview"><CardView card={chosenCard} gild={loadout.gild}/><div><CharacterDetails card={chosenCard}/>{chosenDice && <DiceDetails die={chosenDice} card={chosenCard}/>}</div></aside></div>
        <div className="party-room-actions"><p>{online?.error || (room.phase === 'lobby' ? `已入座 ${room.players.length} 人，其余由 AI 补位。所有真人准备后即可开始。` : game?.phase === 'finished' ? '上局已结束；房主可开启新一局备战，或重看上局战果。' : '对局进行中，可以返回牌桌。')}</p>{room.phase !== 'lobby' ? <>{online?.isHost && game?.phase === 'finished' && <button className="primary" disabled={connecting} onClick={() => action(() => getSession().returnToLobby())}>开启新一局备战<ArrowRight size={16}/></button>}<button className={online?.isHost && game?.phase === 'finished' ? 'secondary' : 'primary'} onClick={() => setView('battle')}>{game?.phase === 'finished' ? '重看上局战果' : '返回对局'}<ArrowRight size={16}/></button></> : <><button className="secondary" disabled={connecting || !mySeat} onClick={() => action(() => getSession().setReady(!mySeat?.ready, { ...loadout, ...(online?.isHost ? { partySettings: settings } : {}) }))}>{mySeat?.ready ? '取消准备' : '准备就绪'}<Check size={16}/></button>{online?.isHost && <button className="primary" disabled={connecting || room.players.some(p => !p.ready) || room.players.length > settings.count} onClick={() => action(startOnline)}>开始对局<ArrowRight size={16}/></button>}</>}</div>
      </>}
      {connecting && <p className="party-connect-status" role="status"><LoaderCircle className="spin" size={16}/>正在连接…</p>}
      {!room && online?.error && <p className="inline-error" role="alert">{online.error}</p>}
    </section>}
  </div>;

  function renderLoadout(disabled: boolean) {
    return <><label>出战角色<select value={loadout.cardId} disabled={disabled} onChange={e => changeLoadout(normalizePartyLoadout({ cardId: e.target.value, gild: profile.gild[e.target.value] || 0 }))}>{cards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>曜彩骰<select value={loadout.prismaticId || ''} disabled={disabled || !chosenCard.prismaticId} onChange={e => changeLoadout({ ...loadout, prismaticId: e.target.value || undefined })}><option value={chosenCard.prismaticId || ''}>{chosenCard.prismaticId ? `${diceById[chosenCard.prismaticId]?.name || '角色默认'} · 默认` : '此角色无曜彩骰'}</option>{prismaticDice.filter(d => d.id !== chosenCard.prismaticId).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>{!room && <details className="party-loadout-details"><summary>查看角色与骰子技能</summary><CharacterDetails card={chosenCard}/>{chosenDice && <DiceDetails die={chosenDice} card={chosenCard}/>}</details>}</>;
  }
  function renderSettings(disabled: boolean) {
    const selectedMode = (room?.mode || mode) as PartyMode;
    return <><div className="party-settings-row"><label>总人数<select disabled={disabled || !!room} value={room?.capacity || settings.count} onChange={e => changeSettings({ ...settings, count: Number(e.target.value) })}>{[4, 5, 6, 7, 8].filter(n => validPartyCount(selectedMode, n)).map(n => <option key={n} value={n}>{n} 人</option>)}</select></label><label>回合上限<select disabled={disabled} value={settings.maxRounds} onChange={e => changeSettings({ ...settings, maxRounds: Number(e.target.value) })}><option value={6}>6 轮 · 快局</option><option value={8}>8 轮 · 标准</option><option value={12}>12 轮 · 长局</option></select></label></div>{selectedMode === 'overlord' && <label><span><Crown size={14}/>首领人选</span><select disabled={disabled} value={settings.bossId} onChange={e => changeSettings({ ...settings, bossId: e.target.value })}><option value="">{room ? '房主担任首领' : '我来当首领'}</option>{room?.players.filter(p => p.seat !== 0).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}{(!room || room.players.length < settings.count) && <option value="ai">AI 首领 · 我方讨伐</option>}</select></label>}</>;
  }
}
