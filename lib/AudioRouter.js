'use strict';

const https = require('https');

const FALLBACK_RECITERS = {
  'Mishary Al-Afasy':     { mp3quran: 'https://server8.mp3quran.net/afs/',   everyayah: 'Alafasy_128kbps'             },
  'Abdul Basit':          { mp3quran: 'https://server7.mp3quran.net/basit/',  everyayah: 'Abdul_Basit_Murattal_192kbps'},
  'Maher Al-Muaiqly':     { mp3quran: 'https://server12.mp3quran.net/maher/', everyayah: 'Maher_AlMuaiqly_64kbps'      },
  'Saud Al-Shuraim':      { mp3quran: 'https://server7.mp3quran.net/shur/',   everyayah: null                          },
  'Nasser Al-Qatami':     { mp3quran: 'https://server6.mp3quran.net/qtm/',    everyayah: null                          },
  'Hani Ar-Rifai':        { mp3quran: 'https://server8.mp3quran.net/hani/',   everyayah: null                          },
  'Mohammed Al-Minshawi': { mp3quran: 'https://server10.mp3quran.net/minsh/', everyayah: null                          },
};

// Default adhan recordings — overridable later; users can also map their own in
// the speaker-app Flow that reacts to the `audio_requested` trigger.
const ADHAN_URLS = {
  'Full adhan':  'https://www.islamcan.com/audio/adhan/azan1.mp3',
  'Short adhan': 'https://www.islamcan.com/audio/adhan/azan2.mp3',
};

// Verse-by-verse adhkar playlists (everyayah.com).
const ADHKAR = {
  morning: [
    'https://everyayah.com/data/Alafasy_128kbps/002255.mp3', // Ayatul Kursi
    'https://everyayah.com/data/Alafasy_128kbps/112001.mp3', // Al-Ikhlas
  ],
  evening: [
    'https://everyayah.com/data/Alafasy_128kbps/113001.mp3', // Al-Falaq
    'https://everyayah.com/data/Alafasy_128kbps/114001.mp3', // An-Nas
  ],
};

class AudioRouter {
  constructor(homey) {
    this.homey = homey;
    this._adhkarTimers = [];   // follow-up plays; cancellable on reschedule
  }

  _enabled() {
    return (this.homey.settings.get('advanced') || {}).appEnabled !== false;
  }

  // Cancel any pending adhkar follow-up timers (called by the scheduler on reschedule).
  clearScheduled() {
    this._adhkarTimers.forEach(h => this.homey.clearTimeout(h));
    this._adhkarTimers = [];
  }

  async dispatch(prayerName) {
    if (!this._enabled()) return;

    const groups      = this.homey.settings.get('speakerGroups') || [];
    const prayerAudio = this.homey.settings.get('prayerAudio') || {};
    const audioConfig = this.homey.settings.get('audioConfig') || {};
    const pCfg = prayerAudio[prayerName] || {};
    if (pCfg.adhanType === 'Silent (Flow only)') return;

    for (const group of groups) {
      if (!group.enabled || !group.speakers?.length) continue;
      for (const speaker of group.speakers) {
        if (!speaker.speakerId) continue;
        try {
          await this._dispatchToGroup(group, speaker, prayerName, pCfg, audioConfig);
        } catch (e) {
          this.homey.app.logger.error(`AudioRouter.dispatch[${group.name}/${speaker.speakerName}]`, e);
        }
      }
    }
  }

  async _dispatchToGroup(group, speaker, prayerName, pCfg, audioConfig) {
    const baseVol = pCfg.volume ?? group.volume ?? null;
    const vol = baseVol != null ? this._resolveVolume(baseVol, audioConfig) : null;

    switch (group.contentType) {
      case 'Full adhan':
      case 'Short adhan': {
        const url = ADHAN_URLS[group.contentType] || ADHAN_URLS['Full adhan'];
        await this._requestPlayback(group, speaker, { type: group.contentType, url, prayer: prayerName, volume: vol });
        break;
      }
      case 'Quran recitation': {
        const url = await this._buildQuranUrl(
          group.surahNumber || 1,
          audioConfig.globalReciter,
        );
        await this._requestPlayback(group, speaker, { type: 'Quran recitation', url, prayer: prayerName, volume: vol });
        break;
      }
      case 'Morning adhkar':
        if (prayerName === 'Fajr') await this._playAdhkar(group, speaker, audioConfig, 'morning');
        break;
      case 'Evening adhkar':
        if (prayerName === 'Asr') await this._playAdhkar(group, speaker, audioConfig, 'evening');
        break;
      case 'Custom URL': {
        const url = group.customUrl;
        if (url) await this._requestPlayback(group, speaker, { type: 'Custom URL', url, prayer: prayerName, volume: vol });
        break;
      }
    }
  }

  /**
   * Single playback path. Preferred mechanism is a DIRECT cast: Google Chromecast
   * devices expose a per-device `castAudio` Flow-action card, which we invoke via
   * the Web API (`runFlowCardAction`) — no user Flow wiring needed. For any speaker
   * we can't cast directly, we fall back to the `audio_requested` Flow trigger so
   * the user can bridge it to their own speaker app's "play a URL" action.
   * Volume is best-effort set on speakers exposing `volume_set`, and we emit a
   * realtime event for the settings live view.
   */
  async _requestPlayback(group, speaker, { type, url, prayer, volume }) {
    if (volume != null) await this._setVolume(speaker.speakerId, volume);

    // 1. Try a direct cast (Chromecast/Google). Returns true if it played.
    const casted = url ? await this._castAudioDirect(speaker.speakerId, url) : false;

    // 2. Fallback for non-cast speakers: nudge play + fire the bridge trigger.
    if (!casted) {
      const devices = await this.homey.app.homeyApi.devices.getDevices();
      const device = devices[speaker.speakerId];
      if (device?.capabilities?.includes('speaker_playing')) {
        try { await device.setCapabilityValue('speaker_playing', true); }
        catch (e) { this.homey.app.logger.warn('speaker_playing resume rejected:', e.message); }
      }
      // Non-cast speakers: log the URL so advanced users can see it in Homey Insights.
      this.homey.app.logger.log(`AudioRouter: non-cast speaker ${speaker.speakerId} — ${type} ${url || ''} (prayer: ${prayer || ''})`);

    }

    await this.homey.api.realtime('play_audio', {
      zoneId: group.id, speakerId: speaker.speakerId, type, url, prayer, volume, casted,
    });
  }

  /**
   * Cast an audio URL straight to a Google Chromecast device via its per-device
   * `castAudio` action card. Returns true on success, false if the device isn't a
   * Chromecast or the cast failed (so the caller can fall back to the trigger).
   */
  async _castAudioDirect(speakerId, url) {
    try {
      const devices = await this.homey.app.homeyApi.devices.getDevices();
      const device  = devices[speakerId];
      const owner   = device?.ownerUri || device?.driverUri || '';
      if (!owner.includes('chromecast')) return false;

      await this.homey.app.homeyApi.flow.runFlowCardAction({
        id:   'castAudio',
        uri:  `homey:device:${speakerId}`,
        args: { url },
      });
      this.homey.app.logger.log(`Cast audio → ${device.name}: ${url}`);
      return true;
    } catch (e) {
      this.homey.app.logger.error(`AudioRouter.castAudioDirect[${speakerId}]: ${e.message}`);
      return false;
    }
  }

  async _setVolume(speakerId, volume) {
    const devices = await this.homey.app.homeyApi.devices.getDevices();
    const device = devices[speakerId];
    if (!device) return;
    if (device.capabilities?.includes('volume_set')) {
      await device.setCapabilityValue('volume_set', volume / 100);
    }
  }

  async _buildQuranUrl(surahNumber, reciterName) {
    const surah = String(surahNumber || 1).padStart(3, '0');
    const reciter = FALLBACK_RECITERS[reciterName] || FALLBACK_RECITERS['Mishary Al-Afasy'];
    const primary = `${reciter.mp3quran}${surah}.mp3`;
    if (await this._reachable(primary)) return primary;
    return `https://download.quranicaudio.com/quran/mishaari_raashid_al_3afaasee/${surah}.mp3`;
  }

  async _playAdhkar(group, speaker, audioConfig, type) {
    const cfgKey = type === 'morning' ? 'morningAdhkar' : 'eveningAdhkar';
    const cfg = this.homey.settings.get(cfgKey) || {};
    if (!cfg.enabled) return;
    this._scheduleAdhkarPlaylist(group, speaker, audioConfig, type, (cfg.delayMin || 0) * 60000);
  }

  _scheduleAdhkarPlaylist(group, speaker, audioConfig, type, initialDelayMs = 0) {
    const playlist   = ADHKAR[type] || ADHKAR.morning;
    const prayerName = type === 'morning' ? 'Fajr' : 'Asr';
    let offset = initialDelayMs;
    for (const url of playlist) {
      const vol = this._resolveVolume(group.volume ?? 50, audioConfig);
      const h = this.homey.setTimeout(
        () => this._requestPlayback(group, speaker, { type: `${type} adhkar`, url, prayer: prayerName, volume: vol })
          .catch(e => this.homey.app.logger.error('AudioRouter.adhkar', e)),
        offset,
      );
      this._adhkarTimers.push(h);
      offset += 3 * 60000;
    }
  }

  _resolveVolume(prayerVol, audioConfig) {
    if (!audioConfig.nightMode) return prayerVol;
    const now = new Date();
    const curr = now.getHours() * 60 + now.getMinutes();
    const [sh, sm] = (audioConfig.quietStart || '22:00').split(':').map(Number);
    const [eh, em] = (audioConfig.quietEnd   || '06:00').split(':').map(Number);
    const qs = sh * 60 + sm;
    const qe = eh * 60 + em;
    const inQuiet = qs > qe ? curr >= qs || curr < qe : curr >= qs && curr < qe;
    return inQuiet ? (audioConfig.quietVol ?? 25) : prayerVol;
  }

  _reachable(url) {
    return new Promise(resolve => {
      const req = https.request(url, { method: 'HEAD' }, r => resolve(r.statusCode < 400));
      req.on('error', () => resolve(false));
      req.setTimeout(3000, () => { req.destroy(); resolve(false); });
      req.end();
    });
  }

  getReciterNames() {
    return Object.keys(FALLBACK_RECITERS);
  }

  // ── Public helpers for the manual Flow action cards ──────────────────────────

  async playAdhan(group, type, volume) {
    const audioConfig = this.homey.settings.get('audioConfig') || {};
    const baseVol = volume ?? group.volume ?? null;
    const vol = baseVol != null ? this._resolveVolume(baseVol, audioConfig) : null;
    const url = ADHAN_URLS[type] || ADHAN_URLS['Full adhan'];
    for (const speaker of group.speakers || []) {
      if (speaker.speakerId) await this._requestPlayback(group, speaker, { type, url, prayer: 'manual', volume: vol });
    }
  }

  async playQuran(group, surahNumber, reciterName, volume) {
    const audioConfig = this.homey.settings.get('audioConfig') || {};
    const baseVol = volume ?? group.volume ?? null;
    const vol = baseVol != null ? this._resolveVolume(baseVol, audioConfig) : null;
    const url = await this._buildQuranUrl(surahNumber, reciterName);
    for (const speaker of group.speakers || []) {
      if (speaker.speakerId) await this._requestPlayback(group, speaker, { type: 'Quran recitation', url, prayer: 'manual', volume: vol });
    }
  }

  async playAdhkar(group, type) {
    const audioConfig = this.homey.settings.get('audioConfig') || {};
    for (const speaker of group.speakers || []) {
      if (speaker.speakerId) this._scheduleAdhkarPlaylist(group, speaker, audioConfig, type, 0);
    }
  }

  async stopGroup(group) {
    if (!group?.speakers?.length) return;
    this.clearScheduled();
    const devices = await this.homey.app.homeyApi.devices.getDevices();
    for (const speaker of group.speakers) {
      const device = devices[speaker.speakerId];
      if (device?.capabilities?.includes('speaker_playing')) {
        await device.setCapabilityValue('speaker_playing', false).catch(() => {});
      }
    }
  }
}

module.exports = AudioRouter;
