// The look of every email, the same as Pocket Hotel's: a rounded card, a big code that selects with one tap,
// an "Open app" button, and a dark-mode version. Inline styles and tables only, because mail apps ignore most other CSS.

export const REPO_URL = 'https://github.com/king55-hack/pocket-pasal'
export const APP_URL = 'https://pasal.rajanrimal.com.np'

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const safeUrl = (u: string) => (/^https:\/\/[^\s"'<>]+$/.test(u) ? u : APP_URL)

const FONT = "-apple-system,Segoe UI,Roboto,'Noto Sans Devanagari',Helvetica,Arial,sans-serif"

function shell(inner: string, preheader: string, appUrl: string): string {
  const url = safeUrl(appUrl)
  return `<!doctype html>
<html lang="ne"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<title>Pocket Pasal</title>
<style>
@media (prefers-color-scheme: dark){
  .bg{background:#10151d !important}.card{background:#1a222d !important}.ink{color:#eef1f6 !important}.mute{color:#9aa6b8 !important}
  .codebox{background:#1b2c4a !important}.code{color:#8db4f2 !important}
}
</style></head>
<body class="bg" style="margin:0;padding:0;background:#f4f6fb;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="bg" style="background:#f4f6fb;"><tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;">
    <tr><td style="padding:0 4px 14px 4px;font:700 18px/1 ${FONT};color:#1e56b0;">
      <span style="display:inline-block;background:#1e56b0;color:#fff;border-radius:9px;padding:7px 9px;margin-right:8px;font-size:16px;">🛒</span>पकेट पसल · Pocket Pasal
    </td></tr>
    <tr><td class="card" style="background:#ffffff;border-radius:20px;padding:30px 26px;font-family:${FONT};">
      ${inner}
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 4px 0;"><tr><td style="background:#1e56b0;border-radius:12px;">
        <a href="${url}" style="display:inline-block;padding:13px 22px;font:600 16px/1 ${FONT};color:#ffffff;text-decoration:none;">पकेट पसल खोल्नुस् / Open app</a>
      </td></tr></table>
    </td></tr>
    <tr><td class="mute" style="padding:18px 8px 0 8px;font:13px/1.6 ${FONT};color:#6b7280;text-align:center;">
      यो इमेल तपाईंले मागेको होइन भने बेवास्ता गर्नुस्।<br>
      If you did not ask for this email, you can ignore it.<br><br>
      <a href="${url}" style="color:#1e56b0;text-decoration:none;">Website</a> &nbsp;·&nbsp;
      <a href="${REPO_URL}" style="color:#1e56b0;text-decoration:none;">GitHub</a>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`
}

/** Plain text (paragraphs split by blank lines) as a card. Used for every message that has no special design. */
export function textToHtml(text: string, appUrl = APP_URL): string {
  const paras = text.trim().split(/\n{2,}/).map((p) => `<p class="ink" style="margin:0 0 16px 0;font-size:16px;line-height:1.6;color:#1f2a37;">${esc(p).replace(/\n/g, '<br>')}</p>`).join('')
  return shell(paras, text.trim().split('\n')[0].slice(0, 90), appUrl)
}

/** The login code: large, one tap selects all of it, with a dark-mode version. */
export function otpHtml(code: string, appUrl = APP_URL): string {
  return shell(`
      <div class="ink" style="font-size:22px;line-height:1.3;font-weight:700;color:#1f2a37;">तपाईंको प्रमाणीकरण कोड</div>
      <div class="mute" style="font-size:15px;line-height:1.5;color:#6b7280;margin-top:4px;">Your verification code</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 10px 0;"><tr><td align="center" class="codebox" style="background:#e8effb;border-radius:16px;padding:22px 10px;">
        <span class="code" style="display:inline-block;font:700 42px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:10px;color:#1e56b0;-webkit-user-select:all;user-select:all;padding-left:10px;">${esc(code)}</span>
      </td></tr></table>
      <div class="mute" style="text-align:center;font-size:13px;color:#6b7280;margin-bottom:22px;">कोडमा थिच्नुस् र कपी गर्नुस् · Tap the code to select and copy</div>
      <div class="ink" style="font-size:15px;line-height:1.6;color:#1f2a37;">
        यो कोड <b>१० मिनेट</b> सम्म मान्य छ। कसैलाई नदिनुस्।<br>
        <span class="mute" style="color:#6b7280;">Valid for 10 minutes. Never share it with anyone.</span>
      </div>`, `तपाईंको कोड ${code} · Your code ${code}`, appUrl)
}
