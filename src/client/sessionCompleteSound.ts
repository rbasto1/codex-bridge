const SESSION_COMPLETE_SOUND_URL = new URL("./assets/turn-ended.mp3", import.meta.url).href;

export function playSessionCompleteSound(): void {
  if (typeof Audio === "undefined") {
    return;
  }

  const audio = new Audio(SESSION_COMPLETE_SOUND_URL);
  void audio.play().catch(() => undefined);
}
