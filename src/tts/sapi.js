/**
 * Windows 系统语音（SAPI）。
 *
 * 无需下载任何模型，装好即用，作为开箱兜底方案。
 * 用 PowerShell 调 System.Speech，文本通过环境变量传，避免命令行转义问题。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'

/** 列出系统可用语音。 */
export function listVoices({ timeoutMs = 8000 } = {}) {
  const ps = [
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    '$s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo | Select-Object Name, Culture, Gender } | ConvertTo-Json -Compress',
  ].join('; ')

  return new Promise((resolve) => {
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      timeout: timeoutMs,
      windowsHide: true,
    }, (error, stdout) => {
      if (error || !stdout) { resolve([]); return }
      try {
        const d = JSON.parse(String(stdout).trim())
        const arr = Array.isArray(d) ? d : [d]
        resolve(arr.map((v) => ({
          name: v.Name || '',
          culture: v.Culture || '',
          gender: v.Gender || '',
        })).filter((v) => v.name))
      } catch { resolve([]) }
    })
  })
}

/** 挑一个中文语音，没有就返回空串（让系统用默认）。 */
export async function pickChineseVoice() {
  const voices = await listVoices()
  const zh = voices.find((v) => /zh|chinese|huihui|yaoyao|kangkang/i.test(v.name + ' ' + v.culture))
  return zh ? zh.name : ''
}

/**
 * 合成文本，返回 wav 文件的 Buffer。
 * @param {object} o
 * @param {string} o.text
 * @param {string} [o.voice]  语音名，空则自动挑中文
 * @param {number} [o.rate]   -10..10
 * @param {number} [o.volume] 0..100
 */
export function synthesize({ text, voice = '', rate = 0, volume = 100, timeoutMs = 60000 } = {}) {
  return new Promise((resolve) => {
    const body = String(text || '').trim()
    if (!body) { resolve({ ok: false, error: '没有要朗读的文本' }); return }

    const out = path.join(os.tmpdir(), 'vs-sapi-' + Date.now() + '-' + Math.round(Math.random() * 1e6) + '.wav')
    const ps = [
      'Add-Type -AssemblyName System.Speech',
      '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      'if ($env:VS_VOICE) { try { $s.SelectVoice($env:VS_VOICE) } catch {} }',
      '$s.Rate = [int]$env:VS_RATE',
      '$s.Volume = [int]$env:VS_VOLUME',
      '$s.SetOutputToWaveFile($env:VS_OUT)',
      '$s.Speak($env:VS_TEXT)',
      '$s.Dispose()',
    ].join('; ')

    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      timeout: timeoutMs,
      windowsHide: true,
      env: {
        ...process.env,
        VS_TEXT: body,
        VS_VOICE: voice || '',
        VS_RATE: String(Math.max(-10, Math.min(10, Math.round(rate)))),
        VS_VOLUME: String(Math.max(0, Math.min(100, Math.round(volume)))),
        VS_OUT: out,
      },
    }, (error, _stdout) => {
      try {
        if (error) { resolve({ ok: false, error: String(error?.message ?? error) }); return }
        const buf = fs.readFileSync(out)
        if (!buf.length) { resolve({ ok: false, error: 'SAPI 输出为空' }); return }
        resolve({ ok: true, buffer: buf })
      } catch (e) {
        resolve({ ok: false, error: String(e?.message ?? e) })
      } finally {
        try { fs.unlinkSync(out) } catch { /* 忽略 */ }
      }
    })
  })
}

/** 探活：能否列出语音。 */
export async function probe() {
  const voices = await listVoices()
  if (voices.length === 0) return { ok: false, error: '没有可用的系统语音' }
  return { ok: true, voices }
}
