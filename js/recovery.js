/* ==========================================================================
   Smart Academy System — recovery.js
   The "Save your recovery code" screen, used after registering, after a
   password reset, and when generating a new code in Settings.

   tmShowRecoveryCode({ code, email, heading, intro }) shows a full-screen
   panel that cannot be dismissed by accident: the user must tick
   "I have saved my recovery code" before Continue is enabled. Returns a
   Promise that resolves when they continue.
   ========================================================================== */

function tmShowRecoveryCode({ code, email, heading, intro, buttonLabel }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "tm-rc-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "tmRcTitle");

    const card = document.createElement("div");
    card.className = "tm-rc-card";

    const title = document.createElement("h2");
    title.id = "tmRcTitle";
    title.className = "tm-rc-title";
    title.textContent = heading || "Save your recovery code";
    card.appendChild(title);

    if (intro) {
      const p = document.createElement("p");
      p.className = "tm-rc-intro";
      p.textContent = intro;
      card.appendChild(p);
    }

    const codeBox = document.createElement("div");
    codeBox.className = "tm-rc-code";
    codeBox.textContent = code;
    codeBox.setAttribute("aria-label", "Your recovery code");
    card.appendChild(codeBox);

    const warn = document.createElement("div");
    warn.className = "tm-rc-warn";
    const warnTitle = document.createElement("strong");
    warnTitle.textContent = "Please read this carefully";
    const warnList = document.createElement("ul");
    [
      "If you forget your password, you can use this one code to create a new password.",
      "If you lose this code, you will not be able to reset your password, and your account will be lost.",
      "This code is shown only once. Save it now: write it down, take a screenshot, or download it.",
    ].forEach((t) => {
      const li = document.createElement("li");
      li.textContent = t;
      warnList.appendChild(li);
    });
    warn.appendChild(warnTitle);
    warn.appendChild(warnList);
    card.appendChild(warn);

    const actions = document.createElement("div");
    actions.className = "tm-rc-actions";
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "btn btn-tm-outline";
    copyBtn.textContent = "Copy code";
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(code);
        copyBtn.textContent = "Copied ✓";
      } catch {
        // Clipboard can be blocked: select the text so the user can copy by hand.
        const range = document.createRange();
        range.selectNodeContents(codeBox);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        copyBtn.textContent = "Press Ctrl+C / long-press to copy";
      }
    });
    const dlBtn = document.createElement("button");
    dlBtn.type = "button";
    dlBtn.className = "btn btn-tm-outline";
    dlBtn.textContent = "Download as file";
    dlBtn.addEventListener("click", () => {
      const text =
        "Smart Academy System — Recovery code\n\n" +
        "Account: " + (email || "") + "\n" +
        "Recovery code: " + code + "\n" +
        "Created: " + new Date().toLocaleString() + "\n\n" +
        "If you forget your password, use this code on the login page (Forgot password?) to create a new one.\n" +
        "If you lose this code you cannot reset your password and the account will be lost.\n" +
        "Keep this file somewhere safe and private. Do not share it.\n";
      const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "smart-academy-recovery-code.txt";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    actions.appendChild(copyBtn);
    actions.appendChild(dlBtn);
    card.appendChild(actions);

    const label = document.createElement("label");
    label.className = "tm-rc-confirm";
    const check = document.createElement("input");
    check.type = "checkbox";
    check.id = "tmRcSaved";
    label.appendChild(check);
    label.appendChild(document.createTextNode(" I have saved my recovery code in a safe place"));
    card.appendChild(label);

    const go = document.createElement("button");
    go.type = "button";
    go.className = "btn btn-tm-primary btn-lg-tap w-100";
    go.textContent = buttonLabel || "Continue";
    go.disabled = true;
    check.addEventListener("change", () => { go.disabled = !check.checked; });
    go.addEventListener("click", () => {
      overlay.remove();
      document.body.classList.remove("tm-rc-open");
      resolve();
    });
    card.appendChild(go);

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    document.body.classList.add("tm-rc-open");
    copyBtn.focus();
  });
}
