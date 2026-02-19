// Basit client-side giriş (kod içinde hesaplar)
// Not: Güvenlik için backend gerekir, burada sadece erişim kontrolü var.

const ACCOUNTS = [
  { username: "admin", password: "3265" },
  { username: "user1", password: "1234" },
  { username: "yağız", password: "3169" },
];

function $(id){ return document.getElementById(id); }

function showErr(msg){
  const err = $("err");
  if (!err) return;
  err.textContent = msg;
  err.style.display = "block";
}

function clearErr(){
  const err = $("err");
  if (!err) return;
  err.textContent = "";
  err.style.display = "none";
}

window.addEventListener("DOMContentLoaded", () => {
  const form = $("loginForm");
  const u = $("username");
  const p = $("password");

  if (!form || !u || !p) {
    console.error("Login elementleri bulunamadı. index.html id'lerini kontrol et!");
    showErr("Sayfa hatalı yüklendi. (loginForm/username/password yok)");
    return;
  }

  // Eğer zaten giriş yaptıysa direkt ocr'a at
  const sessionUser = localStorage.getItem("session_user");
  if (sessionUser) {
    window.location.href = "ocr.html";
    return;
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    clearErr();

    const username = u.value.trim();
    const password = p.value;

    if (!username || !password) {
      showErr("Kullanıcı adı ve şifre boş olamaz.");
      return;
    }

    const ok = ACCOUNTS.some(a => a.username === username && a.password === password);
    if (!ok) {
      showErr("Hatalı kullanıcı adı veya şifre.");
      return;
    }

    localStorage.setItem("session_user", username);
    window.location.href = "ocr.html";
  });
});
