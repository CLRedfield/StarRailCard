import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, Check, ChevronRight, CircleHelp, Coins, Dice5, Download, Gem, Home, Layers3, LoaderCircle, Maximize, Moon, Settings, ShoppingBag, Sparkles, Sun, Swords, Trophy, Upload, Users, Volume2, X } from 'lucide-react';
import { cards, cardById, diceById, prismaticDice, coopStages, progression } from './data';
import { applyCommand, chooseAiCommand, createMatch, getLegalActions } from './game';
import type { GameCommand, GameState, MatchConfig } from './game/types';
import { OnlineSession, DEFAULT_BROKER, gameCommandScope, gameStateCodec } from './net';
import type { OnlineSnapshot, SessionCheckpoint } from './net';
import { exportProfile, isProfile, migrateProfile, readSave, writeSave, WEB_STARTER_COINS } from './lib/storage';
import type { Profile } from './lib/storage';
import { createStarterProfile, levelForXp, rewardVictory } from './lib/progression';
import { playSound, setMusic, setEffectsVolume, unlockAudio } from './lib/audio';
import { BattleSoundTracker, commandSuccessSound } from './lib/battleAudio';
import { useBattlePresentation } from './lib/useBattlePresentation';
import CardView, { asset } from './components/CardView';
import Collection from './components/Collection';
import Campaign, { getChallenges } from './components/Campaign';
import type { Challenge } from './components/Campaign';
import Battle from './components/Battle';
import { DICE_ROLL_MAX_MS, type PendingDiceRoll } from './components/DiceTray';
import Shop from './components/Shop';
import Modal from './components/Modal';
import OnlinePanel from './components/OnlinePanel';
import PartyHub from './components/PartyHub';
import type { Loadout } from './components/OnlinePanel';
import { CharacterDetails, DiceDetails } from './components/LoadoutDetails';
import { createTutorialProgress, getTutorialStep, type TutorialProgress } from './lib/tutorial';

type Page = 'home' | 'campaign' | 'collection' | 'shop' | 'online' | 'battle' | 'party';
interface LocalMatch { state: GameState; challenge?: Challenge; rewarded?: boolean; presentationId?: string; tutorial?: TutorialProgress; }
const features = ['264013', '264026', '264014'];
const initialLoadout: Loadout = { cardId: '264026', prismaticId: cardById['264026']?.prismaticId || '264419', gild: 2 };
// A browser tab owns its seat; refreshing must not restore another tab's seat.
const onlineSaveKey = (() => {
  try {
    let id = sessionStorage.getItem('starrailcard-tab');
    if (!id) { id = crypto.randomUUID(); sessionStorage.setItem('starrailcard-tab', id); }
    return `online:${id}`;
  } catch { return `online:${crypto.randomUUID()}`; }
})();

export default function App() {
  const [profile, setProfile] = useState<Profile | null>(null), [freeProfile, setFreeProfile] = useState<Profile | null>(null);
  const [page, setPage] = useState<Page>('home'), [freeCollection, setFreeCollection] = useState(false);
  const [toast, setToast] = useState(''), [settingsOpen, setSettingsOpen] = useState(false), [aboutOpen, setAboutOpen] = useState(false);
  const [partyInBattle, setPartyInBattle] = useState(false);
  const [local, setLocal] = useState<LocalMatch | null>(null), localRef = useRef<LocalMatch | null>(null);
  const [prepare, setPrepare] = useState<{ mode: 'classic' | 'coop'; challenge?: Challenge } | null>(null);
  const [opponentId, setOpponentId] = useState('264014'), [allyId, setAllyId] = useState('264026');
  const [coopChoice, setCoopChoice] = useState(coopStages[0].id);
  const [online, setOnline] = useState<OnlineSnapshot<GameState> | null>(null), [broker, setBroker] = useState(DEFAULT_BROKER);
  const [pendingCommands, setPendingCommands] = useState<GameCommand[]>([]), networkPending = useRef(new Set<string>());
  const [pendingRoll, setPendingRoll] = useState<PendingDiceRoll>();
  const networkBusy = pendingCommands.length > 0;
  const [loadout, setLoadout] = useState<Loadout>(initialLoadout);
  const [onlineSave, setOnlineSave] = useState<SessionCheckpoint<GameState> | null>(null);
  const sessionRef = useRef<OnlineSession<GameState, GameCommand> | null>(null);
  const onlineUnsub = useRef<(() => void) | undefined>(undefined);
  const profileRef = useRef(profile); profileRef.current = profile;
  const fileInput = useRef<HTMLInputElement>(null);
  const inviteAttempted = useRef(false);
  const soundTracker = useRef(new BattleSoundTracker());
  const theme = profile?.settings.theme || 'light';
  const notify = useCallback((message: string) => setToast(message), []);
  const updateProfile = useCallback((p: Profile) => { setProfile(p); profileRef.current = p; void writeSave('profile', p); }, []);
  const updateFree = useCallback((p: Profile) => { setFreeProfile(p); void writeSave('free-profile', p); }, []);
  const commitLocal = useCallback((m: LocalMatch | null) => { localRef.current = m; setLocal(m); void writeSave('match', m); }, []);
  const tutorialSkippedInSession = useRef(false);
  const updateTutorial = useCallback((tutorial: TutorialProgress) => {
    const current = localRef.current;
    if (tutorial.status === 'skipped') tutorialSkippedInSession.current = true;
    if (!current || !current.tutorial || JSON.stringify(current.tutorial) === JSON.stringify(tutorial)) return;
    commitLocal({ ...current, tutorial });
  }, [commitLocal]);
  useEffect(() => {
    let active = true;
    void Promise.all([readSave<Profile>('profile'), readSave<Profile>('free-profile'), readSave<LocalMatch>('match'), readSave<SessionCheckpoint<GameState>>(onlineSaveKey)]).then(([saved, free, match, checkpoint]) => {
      if (!active) return;
      const previous = saved && isProfile(saved) ? saved : undefined;
      const grantedStarter = !!previous && previous.starterSupplyVersion !== 1;
      const p = previous ? migrateProfile(previous) : createStarterProfile();
      setProfile(p); profileRef.current = p;
      if (p !== previous) {
        void writeSave('profile', p);
        if (grantedStarter) notify(`新手补给已到账：${WEB_STARTER_COINS} 战力币，可在商店购买基础角色。`);
      }
      if (free && isProfile(free)) {
        const nextFree = migrateProfile(free);
        setFreeProfile(nextFree);
        if (nextFree !== free) void writeSave('free-profile', nextFree);
      } else {
        setFreeProfile({ ...p, selectedCard: initialLoadout.cardId, selectedDice: initialLoadout.prismaticId || '', gild: { [initialLoadout.cardId]: 2 } });
      }
      if (match?.state?.version === 1 && Array.isArray(match.state.players)) {
        const restored = match.challenge?.id === 'classic-1' && !match.tutorial ? { ...match, tutorial: createTutorialProgress(match.state, 'player') } : match;
        setLocal(restored); localRef.current = restored;
      }
      if (checkpoint?.protocol === 2) { setOnlineSave(checkpoint); setBroker(checkpoint.broker); }
      else if (checkpoint) { notify('联机协议已更新，请双方更新后重新建房。养成存档已保留。'); void writeSave(onlineSaveKey, null); }
    });
    return () => { active = false; };
  }, []);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 4200); return () => clearTimeout(t); } }, [toast]);
  useEffect(() => { if (profile) { setMusic(profile.settings.music); setEffectsVolume(profile.settings.effects); document.documentElement.dataset.motion = profile.settings.reducedMotion ? 'reduced' : 'full'; } }, [profile?.settings]);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f3f0fb' : '#15132b');
  }, [theme]);
  useEffect(() => () => { onlineUnsub.current?.(); sessionRef.current?.destroy(); }, []);

  const getSession = useCallback(() => {
    if (sessionRef.current && !sessionRef.current.getSnapshot().room && (sessionRef.current.getSnapshot().connection === 'offline' || sessionRef.current.broker !== broker)) { onlineUnsub.current?.(); sessionRef.current.destroy(); sessionRef.current = null; }
    if (!sessionRef.current) {
      const s = new OnlineSession<GameState, GameCommand>({ name: profileRef.current?.name || '开拓者', broker,
        reduce: (state, command, context) => {
          const actor = state.players.find(p => p.id === command.playerId);
          if (!actor || (command.playerId !== context.playerId && !(context.seat === 0 && actor.isAI))) throw new Error('不能操作其他玩家的骰子');
          const result = applyCommand(state, command); if (result.error) throw new Error(result.error); return result.state;
        },
        commandScope: gameCommandScope, stateCodec: gameStateCodec,
        validateState: (v): v is GameState => !!v && typeof v === 'object' && (v as GameState).version === 1 && Array.isArray((v as GameState).players) && !!(v as GameState).catalog,
        persist: async checkpoint => { setOnlineSave(checkpoint); await writeSave(onlineSaveKey, checkpoint); },
      });
      sessionRef.current = s;
      let previous = s.getSnapshot();
      onlineUnsub.current = s.subscribe(() => {
        const snapshot = s.getSnapshot(); setOnline(snapshot);
        if (snapshot.game && !previous.game && ['playing', 'paused'].includes(snapshot.status)) setPage('battle');
        if ((snapshot.status === 'lobby' || snapshot.status === 'closed') && snapshot.status !== previous.status) setPage('online');
        previous = snapshot;
      });
      setOnline(s.getSnapshot());
    }
    return sessionRef.current;
  }, [broker]);
  useEffect(() => {
    if (!profile || inviteAttempted.current) return;
    const params = new URLSearchParams(location.search);
    if (params.has('room') && params.has('party')) { inviteAttempted.current = true; setPage('party'); return; }
    if (params.has('room')) { inviteAttempted.current = true; setPage('online'); void getSession().joinRoom(location.href).catch(e => notify(String(e.message || e))); }
  }, [profile, getSession, notify]);

  const isOnline = !!online?.game && ['playing', 'paused'].includes(online.status);
  const game = isOnline ? online!.game! : local?.state;
  const myId = isOnline ? online!.myId : 'player';
  const presentationKey = isOnline ? `online:${online?.room?.epoch || ''}:${online?.matchId || ''}:${online?.recoveryRevision || 0}` : `local:${local?.presentationId || 'restored'}`;
  const presentation = useBattlePresentation(game, {
    active: page === 'battle',
    matchKey: presentationKey,
    reducedMotion: profile?.settings.reducedMotion ?? false,
  });
  const presentationBusy = presentation.busy;
  const tutorialPausesOpponent = !isOnline && !!game && !!local?.tutorial && getTutorialStep(game, myId, local.tutorial).pauseOpponent;
  useEffect(() => {
    const volume = profileRef.current?.settings.effects || 0;
    soundTracker.current.consume(presentation, presentationKey, page === 'battle').forEach(kind => playSound(kind, volume));
  }, [presentation, presentationKey, page]);
  const send = useCallback((command: GameCommand) => {
    if (presentationBusy) return;
    if (sessionRef.current?.getSnapshot().game && ['playing', 'paused'].includes(sessionRef.current.getSnapshot().status)) {
      if (networkPending.current.has(command.playerId)) return;
      networkPending.current.add(command.playerId);
      setPendingCommands(previous => [...previous, command]);
      const roll = command.type === 'reroll' ? { id: crypto.randomUUID(), playerId: command.playerId, diceIds: [...command.diceIds], afterEventId: sessionRef.current.getSnapshot().game!.log.at(-1)?.id || 0 } : undefined;
      if (roll) setPendingRoll(roll);
      const isAI = !!sessionRef.current.getSnapshot().game?.players.find(player => player.id === command.playerId)?.isAI;
      void sessionRef.current.sendCommand(command).then(() => {
        const sound = commandSuccessSound(command, isAI);
        if (sound) playSound(sound, profileRef.current?.settings.effects || 0);
      }).catch(e => notify(e instanceof Error ? e.message : '操作未成功')).finally(() => {
        networkPending.current.delete(command.playerId);
        setPendingCommands(previous => previous.filter(c => c !== command));
        if (roll) setPendingRoll(previous => previous?.id === roll.id ? undefined : previous);
      }); return;
    }
    const current = localRef.current; if (!current) return;
    const result = applyCommand(current.state, command);
    if (result.error) { notify(result.error); return; }
    const sound = commandSuccessSound(command, !!current.state.players.find(player => player.id === command.playerId)?.isAI);
    if (sound) playSound(sound, profileRef.current?.settings.effects || 0);
    commitLocal({ ...current, state: result.state });
  }, [commitLocal, notify, presentationBusy]);
  useEffect(() => {
    if (page !== 'battle' || !game || presentationBusy || networkBusy || tutorialPausesOpponent || game.phase === 'finished' || online?.status === 'paused' || (isOnline && !online?.isHost)) return;
    const bot = game.players.find(p => p.isAI && (getLegalActions(game, p.id).canAct || getLegalActions(game, p.id).canShop));
    if (!bot) return;
    const timer = setTimeout(() => { const action = chooseAiCommand(game, bot.id); if (action) send(action); }, profile?.settings.reducedMotion ? 90 : DICE_ROLL_MAX_MS + 50);
    return () => clearTimeout(timer);
  }, [game, page, isOnline, online?.isHost, online?.status, profile?.settings.reducedMotion, presentationBusy, networkBusy, tutorialPausesOpponent, send]);
  useEffect(() => {
    if (!local || local.state.phase !== 'finished' || local.rewarded || !profileRef.current) return;
    if (page === 'battle' && !isOnline && presentation.state?.phase !== 'finished') return;
    commitLocal({ ...local, rewarded: true });
    if (local.state.winner === 0 && local.challenge) {
      updateProfile(rewardVictory(profileRef.current, local.challenge.id, local.challenge.rewardId));
      notify('挑战完成，奖励与养成进度已保存。');
    }
  }, [local, commitLocal, updateProfile, notify, page, isOnline, presentation.state?.phase]);

  function launchLocal(mode: 'classic' | 'coop', challenge?: Challenge) {
    if (!profile || !freeProfile) return;
    const p = challenge ? profile : freeProfile;
    const card = cardById[p.selectedCard] || cards[0];
    const player = { id: 'player', name: profile.name, cardId: card.id, prismaticId: p.selectedDice || card.prismaticId || undefined, gild: p.gild[card.id] || 0 };
    const coopStage = coopStages.find(c => c.id === (challenge?.id.slice(5) || coopChoice)) || coopStages[0];
    const config: MatchConfig = mode === 'classic' ? { mode: 'classic', players: [player, { id: 'enemy', name: challenge?.name || '练习对手', cardId: challenge?.opponentId || opponentId, gild: challenge?.opponentGild, prismaticId: challenge?.opponentPrismaticId, isAI: true }], weather: challenge?.weather?.length ? challenge.weather : 'random' } : { mode: 'coop', players: [player, { id: 'ally', name: challenge ? `${coopStage.companionName} · 队友` : `${cardById[allyId].name} · 队友`, cardId: challenge ? coopStage.companionCardId || allyId : allyId, isAI: true }], coopStageId: coopStage.id, bossPhases: (challenge?.bossIds || coopStage.bossCardIds).map(cardId => ({ cardId })) };
    try {
      const state = createMatch(config, Date.now());
      const attachTutorial = challenge?.id === 'classic-1' || (mode === 'classic' && !challenge && !profile.completed.includes('classic-1') && !tutorialSkippedInSession.current);
      commitLocal({ state, challenge, presentationId: crypto.randomUUID(), ...(attachTutorial ? { tutorial: createTutorialProgress(state, player.id) } : {}) });
      setPrepare(null); setPage('battle'); playSound('roll', profile.settings.effects);
    } catch (e) { notify(e instanceof Error ? e.message : '创建对局失败'); }
  }
  function beginLocal() {
    if (prepare) launchLocal(prepare.mode, prepare.challenge);
  }
  async function startOnline() {
    try {
      const s = getSession(), room = s.getSnapshot().room; if (!room) return;
      const players = [...room.players].sort((a, b) => a.seat - b.seat).map(p => { const l = p.loadout as Loadout | undefined; return { id: p.id, name: p.name, cardId: cards.some(c => c.id === l?.cardId) ? l!.cardId : initialLoadout.cardId, prismaticId: l?.prismaticId, gild: l?.gild || 0 }; });
      const coopStage = coopStages.find(c => c.id === coopChoice) || coopStages[0];
      const config: MatchConfig = { mode: room.mode === 'coop' ? 'coop' : 'classic', players, ...(room.mode === 'coop' ? { coopStageId: coopStage.id, bossPhases: coopStage.bossCardIds.map(cardId => ({ cardId })) } : { weather: 'random' as const, startingSide: 'random' as const }) };
      const seed = crypto.getRandomValues(new Uint32Array(1))[0];
      await s.startMatch(createMatch(config, seed)); setPage('battle');
    } catch (e) { notify(e instanceof Error ? e.message : '无法开始对局'); }
  }
  function exitBattle() {
    if (isOnline) { setPage('online'); if (online?.isHost && game?.phase === 'finished') void getSession().returnToLobby().catch(e => notify(e.message)); }
    else { setPage(local?.challenge ? 'campaign' : 'home'); if (local?.state.phase === 'finished') commitLocal(null); }
  }
  function navigate(next: Page) { setPage(next); playSound('click', profile?.settings.effects || 0); }
  async function importSave(file: File | undefined) {
    if (!file) return;
    try { if (file.size > 1024 * 1024) throw new Error('存档文件过大'); const data: unknown = JSON.parse(await file.text()); if (!isProfile(data)) throw new Error('存档格式或版本不正确'); if (!data.ownedCards.every(id => cards.some(c => c.id === id))) throw new Error('存档包含未知卡牌'); const grantedStarter = data.starterSupplyVersion !== 1; const migrated = migrateProfile(data); updateProfile(migrated); notify(grantedStarter ? `存档已导入，已补发 ${WEB_STARTER_COINS} 战力币新手补给。` : '存档已导入'); } catch (e) { notify(e instanceof Error ? e.message : '导入失败'); }
  }
  if (!profile || !freeProfile) return <div className="boot-screen"><Dice5 size={50}/><p>正在准备你的牌桌</p><LoaderCircle size={20} className="spin"/></div>;
  const level = levelForXp(profile.xp);
  const levelValue = typeof level === 'number' ? level : 1;
  const firstTutorial = getChallenges().find(c => c.id === 'classic-1');
  const needsBeginnerGuide = !profile.completed.includes('classic-1') && !!firstTutorial;
  const chosenProfile = prepare?.challenge ? profile : freeProfile;
  const preparedCard = cardById[chosenProfile.selectedCard] || cards[0];
  const preparedDie = diceById[chosenProfile.selectedDice || preparedCard.prismaticId || ''];
  const preparedAlly = cardById[prepare?.challenge ? (coopStages.find(stage => stage.id === prepare.challenge?.id.slice(5))?.companionCardId || allyId) : allyId];
  const activateAudio = () => { unlockAudio(); setMusic(profile.settings.music); };
  const hideChrome = page === 'battle' || page === 'party' && partyInBattle;
  return <div className={`app ${page === 'battle' ? 'in-battle' : hideChrome ? 'in-party-battle' : ''}`} onPointerDown={activateAudio} onKeyDown={event => { if (!event.repeat && (event.key === 'Enter' || event.key === ' ')) activateAudio(); }}>
    {!hideChrome && <><header className="app-header"><button className="brand" onClick={() => navigate('home')}><span className="brand-icon"><Dice5 size={29}/></span><div><strong>星穹骰局</strong><small>COSMICON COLLECTIVE</small></div><span className="brand-tag">FAN GAME</span></button><nav>{([{ id: 'home', title: '活动大厅', icon: Home }, { id: 'campaign', title: '挑战', icon: Swords }, { id: 'collection', title: '收藏', icon: Layers3 }, { id: 'shop', title: '商店', icon: ShoppingBag }, { id: 'online', title: '联机', icon: Users }, { id: 'party', title: '多人派对', icon: Sparkles }] as const).map(item => <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => { setFreeCollection(false); navigate(item.id); }}><item.icon size={16}/>{item.title}</button>)}</nav><div className="header-right">{page === 'home' && <button className="theme-toggle" aria-label={theme === 'light' ? '切换至暗色主题' : '切换至亮色主题'} title={theme === 'light' ? '切换至暗色主题' : '切换至亮色主题'} aria-pressed={theme === 'dark'} onClick={() => updateProfile({ ...profile, settings: { ...profile.settings, theme: theme === 'light' ? 'dark' : 'light' } })}>{theme === 'light' ? <Sun size={16}/> : <Moon size={16}/>}<span>{theme === 'light' ? '亮色' : '暗色'}</span></button>}<span className="profile-rank">LV.{String(levelValue).padStart(2, '0')}</span><button className="icon-button" aria-label="设置" onClick={() => setSettingsOpen(true)}><Settings size={21}/></button></div></header><div className="top-rule"/></>}
    <main>
      <PartyHub profile={profile} active={page === 'party'} onActivate={() => setPage('party')} onBattleViewChange={setPartyInBattle} toast={notify}/>
      {page === 'home' && <section className="home-page page-enter"><div className="hero-checker"/><div className="hero-grid"/><div className="hero-orbit"/><span className="background-type">ROLL ON!</span><div className="hero-content"><div className="event-label"><span/>多人派对 · 四种全新玩法</div><div className="hero-kicker">COSMICON, ROLL ON AGAIN!</div><h1><span>又上骰了！</span><strong>战力党<span className="title-bang">！</span></strong></h1><p className="hero-description">命运掷下骰子，<br/>而你，决定胜负。</p><div className="hero-actions" style={{ flexWrap: 'wrap' }}>{needsBeginnerGuide && <button className="primary hero-primary" onClick={() => launchLocal('classic', firstTutorial)}><Sparkles size={20}/>新手第一局<ArrowRight size={21}/></button>}<button className={needsBeginnerGuide ? 'secondary hero-secondary' : 'primary hero-primary'} onClick={() => setPrepare({ mode: 'classic' })}><Swords size={needsBeginnerGuide ? 18 : 20}/>{needsBeginnerGuide ? '自由对战' : '开始对战'}{!needsBeginnerGuide && <ArrowRight size={21}/>}</button><button className="secondary hero-secondary" onClick={() => navigate('online')}><Users size={19}/>好友联机</button></div><button className="hero-subaction" onClick={() => navigate('campaign')}>进入活动挑战，收集你的战力卡牌 <ChevronRight size={15}/></button></div><div className="hero-art" aria-label="银河战力党角色卡展示"><div className="hero-star star-1">✦</div><div className="hero-star star-2">✦</div>{features.map((id, i) => <div className={`hero-card hero-card-${i}`} key={id}><CardView card={cardById[id]} gild={i === 1 ? 2 : 1} large/></div>)}<span className="hero-sticker">LET'S<br/><strong>ROLL!</strong></span><div className="floating-die"><Dice5 size={42} strokeWidth={1.5}/></div></div><div className="hero-bottom"><div className="season-mark"><span>02</span><div><strong>商业街争霸赛</strong><small>一张角色卡，无限种可能。</small></div></div><button className="mode-link" onClick={() => navigate('party')}><span className="mode-icon"><Users size={25}/></span><div><small>GALAXY PARTY · 4–8 PLAYERS</small><strong>4～8 人，一起上桌</strong></div><ArrowRight size={20}/></button><button className="mini-guide" onClick={() => { setFreeCollection(true); navigate('collection'); }}><BookOpen size={19}/><span>卡牌与玩法图鉴</span><ArrowRight size={16}/></button></div>{local && local.state.phase !== 'finished' && <button className="resume-banner" onClick={() => navigate('battle')}><RotateIcon/>继续上次对局 · 第 {local.state.turn} 回合<ArrowRight size={17}/></button>}</section>}
      {page === 'campaign' && <Campaign profile={profile} onStart={challenge => setPrepare({ mode: challenge.mode, challenge })}/>}
      {page === 'collection' && <Collection profile={freeCollection ? freeProfile : profile} onChange={freeCollection ? updateFree : updateProfile} onToast={notify} free={freeCollection} onDone={freeCollection ? () => navigate('home') : undefined}/>}
      {page === 'shop' && <Shop profile={profile} onChange={updateProfile} onToast={notify}/>}
      {page === 'online' && <OnlinePanel profile={profile} online={online} getSession={getSession} onStart={startOnline} onRestore={() => { if (onlineSave) void getSession().restore(onlineSave).catch(e => notify(e.message)); }} hasRestore={!!onlineSave && onlineSave.room.phase !== 'closed' && !online?.room} toast={notify} loadout={loadout} setLoadout={setLoadout} broker={broker} setBroker={setBroker} onResume={() => setPage('battle')} coopChoice={coopChoice} setCoopChoice={setCoopChoice}/>}
      {page === 'battle' && presentation.state && <Battle key={presentationKey} state={presentation.state} playerId={myId} send={send} onExit={exitBattle} profile={profile} paused={online?.status === 'paused' && isOnline} busy={pendingCommands.some(c => c.playerId === myId) || presentationBusy} selectionKey={presentationKey} pendingRoll={pendingRoll?.playerId === myId ? pendingRoll : undefined} resolving={presentationBusy} previews={presentation.frozenPreviews} resolution={presentation.resolution} activeEffect={presentation.activeEffect} activeEvent={presentation.activeEvent} activeStrike={presentation.activeStrike} defeats={presentation.defeats} presentationPhase={presentation.phase} pauseReason={online?.pauseReason} isOnline={isOnline} tutorial={!isOnline ? local?.tutorial : undefined} onTutorialChange={updateTutorial}/>}
      {page === 'battle' && !game && <div className="empty-state">对局尚未开始。<button className="primary" onClick={() => navigate('home')}>返回活动大厅</button></div>}
    </main>
    {!hideChrome && <footer className="app-footer"><span><span className="status-dot"/>GALAXY TABLE · READY TO PLAY</span><button onClick={() => setAboutOpen(true)}>还原官方玩法的小游戏 <span>／</span> 素材与制作说明</button><span>愿好点数与你同在 <Sparkles size={12}/></span></footer>}
    {toast && <div role="status" className="toast"><Check size={17}/>{toast}<button onClick={() => setToast('')} aria-label="关闭提示"><X size={14}/></button></div>}
    {prepare && <Modal title={prepare.challenge ? prepare.challenge.title : '自由对战 · 全内容开放'} onClose={() => setPrepare(null)} wide><div className="prepare-layout loadout-prepare"><aside className="loadout-portrait"><CardView card={preparedCard} gild={chosenProfile.gild[chosenProfile.selectedCard] || 0} large/><CharacterDetails key={preparedCard.id} card={preparedCard}/></aside><div className="prepare-form"><div className="segment"><button className={prepare.mode === 'classic' ? 'active' : ''} disabled={!!prepare.challenge} onClick={() => setPrepare({ mode: 'classic' })}><Swords size={15}/>经典 1v1</button><button className={prepare.mode === 'coop' ? 'active' : ''} disabled={!!prepare.challenge} onClick={() => setPrepare({ mode: 'coop' })}><Users size={15}/>双人共斗</button></div><label>出战角色<select value={chosenProfile.selectedCard} onChange={e => { const card = cardById[e.target.value]; (prepare.challenge ? updateProfile : updateFree)({ ...chosenProfile, selectedCard: card.id, selectedDice: card.prismaticId || '' }); }}>{cards.filter(c => !prepare.challenge || profile.ownedCards.includes(c.id)).map(c => <option key={c.id} value={c.id}>{c.name} · {'★'.repeat(c.rarity)}</option>)}</select></label><label>曜彩骰<select disabled={!cardById[chosenProfile.selectedCard]?.prismaticId || (!!prepare.challenge && levelValue < progression.prismaticUnlockLevel)} value={chosenProfile.selectedDice || preparedCard.prismaticId || ''} onChange={e => (prepare.challenge ? updateProfile : updateFree)({ ...chosenProfile, selectedDice: e.target.value })}><option value={preparedCard.prismaticId || ''}>角色默认{preparedCard.prismaticId ? ` · ${diceById[preparedCard.prismaticId]?.name || ''}` : ' · 无曜彩骰'}</option>{prismaticDice.filter(d => d.id !== preparedCard.prismaticId && (!prepare.challenge || profile.ownedDice.includes(d.id))).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>{preparedDie ? <DiceDetails key={preparedDie.id} die={preparedDie} card={preparedCard} caption="当前配置"/> : <p className="loadout-preview-note">此角色不能使用曜彩骰。</p>}{prepare.mode === 'classic' && !prepare.challenge && <label>练习对手<select value={opponentId} onChange={e => setOpponentId(e.target.value)}>{cards.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select></label>}{prepare.mode === 'classic' && !prepare.challenge && <details className="loadout-secondary-detail"><summary>查看对手技能 · {cardById[opponentId].name}</summary><CharacterDetails card={cardById[opponentId]}/></details>}{prepare.mode === 'coop' && <label>AI 队友<select value={preparedAlly.id} disabled={!!prepare.challenge} onChange={e => setAllyId(e.target.value)}>{cards.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select></label>}{prepare.mode === 'coop' && <details className="loadout-secondary-detail"><summary>查看队友技能 · {preparedAlly.name}</summary><CharacterDetails card={preparedAlly}/></details>}<label hidden={prepare.mode !== 'coop' || !!prepare.challenge}>共斗对手<select value={coopChoice} onChange={e => setCoopChoice(e.target.value)}>{coopStages.map(c => <option key={c.id} value={c.id}>{c.name} · {c.difficulty === 'challenge' ? '联机强敌' : '剧情挑战'}</option>)}</select></label><p className="prepare-note">{prepare.challenge ? `${prepare.challenge.name}：${prepare.challenge.intro}` : prepare.mode === 'coop' ? '与 AI 队友配合，交换骰子、使用战术卡，挑战多阶段强敌。' : '自由模式使用完整卡池，不消耗任何养成资源。'}</p><button className="primary full" onClick={beginLocal}>进入牌桌 <ArrowRight size={18}/></button></div></div></Modal>}
    {settingsOpen && <Modal title="设置与存档" onClose={() => setSettingsOpen(false)}><div className="settings-form"><label>玩家昵称<input maxLength={16} value={profile.name} onChange={e => updateProfile({ ...profile, name: e.target.value || '开拓者' })}/></label><label><span><Volume2 size={16}/>背景音乐</span><input type="range" min={0} max={1} step={.05} value={profile.settings.music} onChange={e => updateProfile({ ...profile, settings: { ...profile.settings, music: Number(e.target.value) } })}/></label><label><span><Volume2 size={16}/>交互音效</span><input type="range" min={0} max={1} step={.05} value={profile.settings.effects} onChange={e => updateProfile({ ...profile, settings: { ...profile.settings, effects: Number(e.target.value) } })}/></label><label className="toggle-row">减少动态效果<input type="checkbox" checked={profile.settings.reducedMotion} onChange={e => updateProfile({ ...profile, settings: { ...profile.settings, reducedMotion: e.target.checked } })}/></label><label>渲染质量<select value={profile.settings.quality} onChange={e => updateProfile({ ...profile, settings: { ...profile.settings, quality: e.target.value as 'high' | 'low' } })}><option value="high">精细 · 立体骰子与阴影</option><option value="low">省电 · 降低渲染精度</option></select></label><button className="secondary" onClick={() => { if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => notify('此浏览器暂不支持全屏')); else void document.exitFullscreen(); }}><Maximize size={16}/>切换全屏</button><div className="save-actions"><button className="secondary" onClick={() => exportProfile(profile)}><Download size={16}/>导出存档</button><button className="secondary" onClick={() => fileInput.current?.click()}><Upload size={16}/>导入存档</button><input hidden ref={fileInput} type="file" accept="application/json,.json" onChange={e => { void importSave(e.target.files?.[0]); e.target.value = ''; }}/></div><small className="muted">养成进度自动保存在本浏览器。导出存档后可在其他设备导入。</small></div></Modal>}
    {aboutOpen && <Modal title="关于星穹骰局" onClose={() => setAboutOpen(false)}><div className="prose"><p>星穹骰局是一款还原官方玩法的小游戏，参考《崩坏：星穹铁道》「上骰了！战力党！」与「又上骰了！战力党！」制作。由玩家制作，与官方无隶属关系。</p><p>原作角色、美术及游戏文本归米哈游 / HoYoverse 所有。卡面与界面素材来自公开原作资源归档；数值依据 4.0 和 4.2 已发布版本整理。背景音乐及投骰、确认、攻击、毒液音效由 Suno 生成并裁剪制作，部分轻提示音为程序合成；音频随游戏提供。</p><p>联机使用与 hearthStoneKill2 相同的 EMQX 公共服务器，房主负责对局结算。完整素材来源、数据转换及规则核验记录随源码附带。</p><a href="https://www.taptap.cn/moment/797910836491322059" target="_blank" rel="noreferrer">查看原作共斗玩法介绍 ↗</a></div></Modal>}

  </div>;
}
function RotateIcon() { return <Trophy size={17}/>; }
