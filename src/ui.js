// 页面提示、系统通知和提示音。

const toast = document.querySelector("#toast");
let toastTimeout = null;

export function showToast(message) {
  clearTimeout(toastTimeout);
  toast.textContent = message;
  toast.classList.add("show");
  toastTimeout = window.setTimeout(() => {
    toast.classList.remove("show");
  }, 3200);
}

export function notify(title, body, options = {}) {
  if ("Notification" in window && Notification.permission === "granted") {
    const notification = new Notification(title, { body, ...options });
    notification.onclick = () => {
      // 桌面程序里窗口可能缩在托盘，要先叫出来。
      window.desktop?.showWindow();
      window.focus();
      notification.close();
    };
  }
}

export function playChime() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.frequency.setValueAtTime(660, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(880, context.currentTime + 0.22);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.45);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.48);
  } catch {
    // 页面提示仍然有效，音频不可用时无需中断流程。
  }
}
