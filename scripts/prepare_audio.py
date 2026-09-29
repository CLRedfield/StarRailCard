"""Build mobile-sized audio assets from the preserved Suno A candidates.

Run: python scripts/prepare_audio.py
Requires numpy and either ffmpeg on PATH or the imageio-ffmpeg Python package.
Only public/audio and docs/audio-assets.md are written; sources remain untouched.
"""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import subprocess

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "release" / "audio-candidates"
OUT = ROOT / "public" / "audio"
RATE = 44100


def find_ffmpeg() -> str:
    found = shutil.which("ffmpeg")
    if found:
        return found
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


FFMPEG = find_ffmpeg()

# Windows were chosen from 10 ms RMS envelopes, before later repeated actions.
# They deliberately do not include the 8–10 s multi-action Suno generation.
ASSETS = [
    dict(key="bgm_duel", source="bgm_duel_A.mp3", file="bgm_duel.mp3",
         name="牌局背景音乐", song="a6cd88eb-9f6e-4122-9e2f-d0f94fa07395",
         channels=2, bitrate="96k", start=0.0, end=None, fade_in=0.30, fade_out=1.20),
    dict(key="dice", source="sfx_dice_roll_A.mp3", file="sfx_dice_roll_01.mp3",
         name="投骰／重投", song="636b91fc-a7d8-4275-9ded-ff734db2ac21",
         channels=1, bitrate="64k", start=0.09, end=0.98, fade_in=0.008, fade_out=0.075),
    dict(key="confirm", source="sfx_confirm_A.mp3", file="sfx_confirm.mp3",
         name="落牌确认", song="02c895f8-7155-455b-8498-a31069ece54f",
         channels=1, bitrate="64k", start=0.0, end=0.40, fade_in=0.004, fade_out=0.045),
    dict(key="attack", source="sfx_attack_A.mp3", file="sfx_attack.mp3",
         name="卡牌攻击", song="f09e76da-d28f-4dc3-a84a-a13577367279",
         channels=1, bitrate="64k", start=0.24, end=0.92, fade_in=0.008, fade_out=0.075),
    dict(key="poison", source="sfx_poison_trigger_A.mp3", file="sfx_poison_trigger.mp3",
         name="中毒／引爆", song="034a1db6-1c06-44c2-b8c9-062d4922f16e",
         channels=1, bitrate="64k", start=0.25, end=1.10, fade_in=0.015, fade_out=0.090),
]


def command(args: list[str], data: bytes | None = None) -> subprocess.CompletedProcess:
    result = subprocess.run([FFMPEG, "-hide_banner", "-nostdin", *args],
                            input=data, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr.decode("utf-8", errors="replace"))
    return result


def decode(path: Path, channels: int, filters: str | None = None) -> np.ndarray:
    args = ["-i", str(path), "-map", "0:a:0", "-vn"]
    if filters:
        args += ["-af", filters]
    args += ["-f", "f32le", "-ac", str(channels), "-ar", str(RATE), "pipe:1"]
    return np.frombuffer(command(args).stdout, dtype="<f4").reshape(-1, channels).copy()


def db(value: float) -> float:
    return round(20 * math.log10(max(value, 1e-10)), 2)


def measure(path: Path, channels: int) -> dict:
    pcm = decode(path, channels)
    result = command(["-i", str(path), "-map", "0:a:0", "-vn", "-af",
                      "loudnorm=I=-21:TP=-3:LRA=11:print_format=json", "-f", "null", "-"])
    stderr = result.stderr.decode("utf-8", errors="replace")
    measured = json.loads(re.findall(r"\{\s*\"input_i\".*?\}", stderr, re.S)[-1])
    loudness = float(measured["input_i"])
    true_peak = float(measured["input_tp"])
    return {
        "durationSeconds": round(len(pcm) / RATE, 5),
        "channels": channels,
        "sampleRate": RATE,
        "rmsDbfs": db(float(np.sqrt(np.mean(pcm.astype(np.float64) ** 2)))),
        "samplePeakDbfs": db(float(np.max(np.abs(pcm)))),
        "truePeakDbtp": round(true_peak, 2) if math.isfinite(true_peak) else None,
        "integratedLufs": round(loudness, 2) if math.isfinite(loudness) else None,
    }


def fade(pcm: np.ndarray, start: float, end: float) -> None:
    attack = min(len(pcm), round(start * RATE))
    release = min(len(pcm), round(end * RATE))
    # Half-cosine transitions start/end exactly at zero and preserve transients.
    if attack:
        pcm[:attack] *= (0.5 - 0.5 * np.cos(np.linspace(0, np.pi, attack)))[:, None]
    if release:
        pcm[-release:] *= (0.5 + 0.5 * np.cos(np.linspace(0, np.pi, release)))[:, None]


def encode(pcm: np.ndarray, target: Path, channels: int, bitrate: str) -> None:
    command(["-y", "-f", "f32le", "-ar", str(RATE), "-ac", str(channels),
             "-i", "pipe:0", "-map_metadata", "-1", "-vn", "-codec:a", "libmp3lame",
             "-b:a", bitrate, "-write_xing", "1", "-id3v2_version", "3", str(target)],
            np.asarray(pcm, dtype="<f4").tobytes())


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    records = []
    for asset in ASSETS:
        source = SOURCE / asset["source"]
        source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
        is_music = asset["key"] == "bgm_duel"
        # Remove inaudible low-frequency rumble only from transient effects.
        pcm = decode(source, asset["channels"], None if is_music else "highpass=f=55")
        source_duration = len(pcm) / RATE
        end = asset["end"] if asset["end"] is not None else source_duration
        pcm = pcm[round(asset["start"] * RATE):round(end * RATE)].copy()
        fade(pcm, asset["fade_in"], asset["fade_out"])
        peak = float(np.max(np.abs(pcm)))
        rms = float(np.sqrt(np.mean(pcm.astype(np.float64) ** 2)))
        if is_music:
            # Fixed gain preserves the generated arrangement's dynamics; music
            # is measured before gain rather than compressed to meet loudness.
            original = measure(source, asset["channels"])
            gain = 10 ** ((-21 - original["integratedLufs"]) / 20)
        else:
            gain = 10 ** (-20 / 20) / max(rms, 1e-10)
        # MP3 encoding can overshoot: leave ample room before lossy encoding.
        gain = min(gain, 10 ** (-4.5 / 20) / max(peak, 1e-10))
        pcm *= gain
        target = OUT / asset["file"]
        encode(pcm, target, asset["channels"], asset["bitrate"])
        metrics = measure(target, asset["channels"])
        if metrics["truePeakDbtp"] is not None and metrics["truePeakDbtp"] > -3:
            pcm *= 10 ** ((-3.3 - metrics["truePeakDbtp"]) / 20)
            encode(pcm, target, asset["channels"], asset["bitrate"])
            metrics = measure(target, asset["channels"])
        assert metrics["samplePeakDbfs"] <= -3, metrics
        assert source_hash == hashlib.sha256(source.read_bytes()).hexdigest()
        record = {**asset, "sourceUrl": f"https://suno.com/song/{asset['song']}",
                  "sourceDurationSeconds": round(source_duration, 5),
                  "sourceSha256": source_hash, "start": asset["start"], "end": end,
                  "bytes": target.stat().st_size,
                  "sha256": hashlib.sha256(target.read_bytes()).hexdigest(), **metrics}
        records.append(record)
        print(asset["file"], json.dumps(metrics), record["bytes"])
    total = sum(r["bytes"] for r in records)
    assert total < 3_000_000, total
    manifest = {"version": 1, "generatedOn": "2026-09-28", "totalAudioBytes": total,
                "verification": "Decoded waveform, clipping and loudness checks; no subjective listening review.",
                "assets": records}
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_docs(records, total)
    print(f"Total audio: {total:,} bytes")


def write_docs(records: list[dict], total: int) -> None:
    rows = []
    for r in records:
        lu = str(r["integratedLufs"]) if r["integratedLufs"] is not None else "过短，未量得"
        rows.append(f"| {r['name']} | `{r['file']}` | {r['start']:.2f}–{r['end']:.2f} | "
                    f"{r['durationSeconds']:.3f} | {r['channels']} | {r['bitrate']} | {lu} | "
                    f"{r['rmsDbfs']:.2f} | {r['truePeakDbtp']} | {r['bytes']:,} |")
    sources = [f"- {r['name']}：[Suno A 版]({r['sourceUrl']})；原始文件 "
               f"`release/audio-candidates/{r['source']}`；SHA-256 `{r['sourceSha256']}`。"
               for r in records]
    document = f"""# 星穹骰局音频资产与处理记录

更新：2026-09-28。音频来自用户账号在 Suno 生成的五个 A 版候选，**不是星穹铁道官方原声录音**。保留原始下载不覆盖；运行时只携带 `public/audio/` 中的五个处理成品。五个 MP3 共 **{total:,} 字节**。最终部署包大小由打包核验记录单独确认。

## 成品技术数据

采样率均为 44,100 Hz；指标是最终 MP3 再解码后测量值。短音效 LUFS 仅供技术对照，不能替代听感；所有素材另测了 RMS 和真峰值。

| 用途 | 文件 | 原始截取范围／秒 | 成品秒数 | 声道 | 码率 | LUFS-I | RMS dBFS | 真峰值 dBTP | 字节 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
{chr(10).join(rows)}

完整来源、成品 SHA-256、样本峰值及淡入淡出长度见 [运行时素材清单](../public/audio/manifest.json)。MP3 的时长包含编码器 gapless 元数据处理后的解码长度；播放器显示可能四舍五入。

## 裁剪依据与处理

- 以 10 ms RMS 包络和 100 ms 峰值摘要定位动作。原始投骰、攻击、毒液包含多段重复动作；每次游戏事件只播放选定短片段。
- 投骰：取首个密集弹跳组，原始约 0.1 秒出现首击、0.7 秒开始衰减，约 1.8 秒才是另一动作；保留 0.09–0.98 秒。
- 确认：首组点击在 0–0.35 秒，0.4–0.8 秒安静，0.9 秒又开始第二组；只取 0–0.40 秒。
- 攻击：保留首个完整隆起／衰减脉冲 0.24–0.92 秒，结束于低谷，避免约 1.2 秒后的下一组。
- 毒液：保留首组主体与尾音 0.25–1.10 秒，结束于 1.1 秒低谷；不带入 1.2 秒后的重复脉冲。
- SFX 合并为单声道、55 Hz 高通去低频杂波；按 RMS -20 dBFS 调整，并受 -4.5 dBFS 编码前峰值上限约束。编码后再核验真峰值不超过 -3 dBTP，必要时重新衰减。
- 所有音效首尾做 4–15 ms 淡入与 45–90 ms 淡出，减少剪切点击。短片段保持完整瞬态，无强限幅或动态压缩。
- 背景音乐保留全曲，固定增益按 -21 LUFS-I 调整，维持动态；0.30 秒淡入、1.20 秒淡出，96 kbps 双声道 MP3。其首尾不是按节拍拼接的无缝循环，重复播放会有自然淡出再淡入。

## 来源

{chr(10).join(sources)}

## 可重复生成

在项目根目录运行 `python scripts/prepare_audio.py`。脚本需要 `numpy`，并使用 PATH 中的 FFmpeg；若 PATH 未安装则使用 Python 包 `imageio-ffmpeg` 自带程序。本次环境已有这两个包，无需改变项目 npm 依赖。

脚本只写 `public/audio/**` 与本文档；每次校验原始文件哈希未变，输出可解码、峰值合格且总音频小于 3,000,000 字节。不会把原始试听包带入部署目录。

## 核验范围

本轮已完成解码、时长、波形、裁剪边界、响度、峰值、大小、原始哈希与成品哈希的技术核验。**尚未进行人的主观听审**；不声称音色、配器或循环听感已经获得验证，也不声称还原了官方音频。需要听感调整时应修改脚本中的窗口与增益，再重新生成，避免多次压缩成品。
"""
    (ROOT / "docs" / "audio-assets.md").write_text(document, encoding="utf-8")


if __name__ == "__main__":
    main()
