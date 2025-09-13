document.addEventListener("DOMContentLoaded", function () {
  // =========================
  // Constantes e utilitários
  // =========================
  const PREVIEW_DEFAULT = "Não informado";
  const CONTATO_NOME_MAX = 30;
  const CHIP_MAX_LEN = 30;
  const MSG_TIMEOUT = 2000;
  const SANGUE_HIDE_VALUES = ["", "NI"];

  // Estado de contatos (UI)
  let contatos = []; // { nome, digs }
  let editingIndex = null; // índice em edição (ou null)

  // Timer global do fluxo frente→verso
  let _flowTimer = null;

  // ===== Helpers genéricos =====
  function esc(s) {
    return (s || "").replace(
      /[&<>"']/g,
      (m) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[m],
    );
  }
  function apenasDigitos(s) {
    return (s || "").replace(/\D+/g, "");
  }
  function orDefault(s) {
    return s && String(s).trim() ? s : PREVIEW_DEFAULT;
  }
  function capitalizarTexto(str) {
    if (!str) return "";
    return str
      .toLocaleLowerCase("pt-BR")
      .split(/(\s|-)/)
      .map((tok) =>
        /^(\s|-)+$/.test(tok)
          ? tok
          : tok.charAt(0).toLocaleUpperCase("pt-BR") + tok.slice(1),
      )
      .join("");
  }

  // Pluraliza o rótulo do <strong> que antecede um preview
  function setRotuloPlural(prevId, singular, plural, count) {
    const strong = document
      .getElementById(prevId)
      ?.closest("p")
      ?.querySelector("strong");
    if (!strong) return;
    strong.textContent = (count === 1 ? singular : plural) + ":";
  }

  // Ajusta a fonte do NOME somente se necessário
  function fitNome({ min = 9.5, step = 0.5 } = {}) {
    const el = document.getElementById("nome-prev");
    if (!el) return;
    el.style.fontSize = "";
    const getSize = () => parseFloat(getComputedStyle(el).fontSize || "10.5");
    function shrinkIfNeeded() {
      let s = getSize();
      if (el.clientWidth <= 0) return;
      while (el.scrollWidth > el.clientWidth && s > min) {
        s -= step;
        el.style.fontSize = s + "px";
      }
    }
    requestAnimationFrame(shrinkIfNeeded);
  }

  // SUS
  function formatarSUS(digs) {
    const d = (digs || "").replace(/\D+/g, "").slice(0, 15);
    if (!d) return "";
    const parts = [
      d.slice(0, 3),
      d.slice(3, 7),
      d.slice(7, 11),
      d.slice(11, 15),
    ].filter(Boolean);
    return parts.join(" ");
  }
  function countDigitsBefore(formattedStr, caretIndex) {
    return (formattedStr.slice(0, caretIndex).match(/\d/g) || []).length;
  }
  function caretIndexFromDigitIndex(digitIndex) {
    let spaces = 0;
    if (digitIndex > 3) spaces++;
    if (digitIndex > 7) spaces++;
    if (digitIndex > 11) spaces++;
    return digitIndex + spaces;
  }

  // Telefone
  function formatarFoneBR(digs) {
    if (!digs) return "";
    if (digs.length <= 2) return `(${digs}`;
    if (digs.length === 10)
      return `(${digs.slice(0, 2)}) ${digs.slice(2, 6)}-${digs.slice(6)}`;
    if (digs.length >= 11) {
      const d = digs.slice(0, 11);
      return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    }
    const ddd = digs.slice(0, 2);
    const resto = digs.slice(2);
    return `(${ddd}) ${resto}`;
  }
  function foneValido(digs) {
    return digs.length === 10 || digs.length === 11;
  }

  // Mensagens de contatos
  const CONTATO_HINT_DEFAULT = "Adicione até 3 contatos.";
  let contatoMsgTimer = null;
  function showContatoDefaultHint() {
    const el = document.getElementById("contato-msg");
    if (!el) return;
    if (editingIndex !== null) return;
    el.textContent = CONTATO_HINT_DEFAULT;
    el.title = CONTATO_HINT_DEFAULT;
    el.className = "contato-msg";
  }
  function setContatoMsg(text = "", type = "", opts = {}) {
    const el = document.getElementById("contato-msg");
    if (!el) return;
    if (contatoMsgTimer) {
      clearTimeout(contatoMsgTimer);
      contatoMsgTimer = null;
    }
    el.textContent = text || "";
    el.title = text || "";
    el.className = "contato-msg" + (type ? " " + type : "");
    const defaultMs = type === "success" || type === "warn" ? 2200 : 0;
    const ms = typeof opts.timeout === "number" ? opts.timeout : defaultMs;
    if (ms > 0) {
      const ticket = Date.now();
      el.dataset.ticket = String(ticket);
      contatoMsgTimer = setTimeout(() => {
        if (el.dataset.ticket !== String(ticket)) return;
        el.textContent = "";
        el.title = "";
        el.className = "contato-msg";
        contatoMsgTimer = null;
        showContatoDefaultHint();
      }, ms);
    }
  }

  // ==========================================
  // Foto: preview + hi-res + export helpers
  // ==========================================
  async function capturarCarteirinhaHiDPI(dpi = 600) {
    const src = document.getElementById("carteirinha");
    if (!src) throw new Error("Pré-visualização não encontrada.");

    // Ativa rotação do verso
    const versoEl = src.querySelector(".verso");
    if (versoEl) versoEl.classList.add("modo-dobra");

    // host off-screen
    const host = document.createElement("div");
    Object.assign(host.style, {
      position: "fixed",
      left: "-10000px",
      top: "0",
      background: "#fff",
      zIndex: "-1",
    });

    const clone = src.cloneNode(true);
    clone.style.transform = "none";
    clone.style.zoom = "1";
    host.appendChild(clone);
    document.body.appendChild(host);

    try {
      // usa imagem hi-res no clone
      const origFoto = src.querySelector("#foto-preview");
      const cloneFoto = clone.querySelector("#foto-preview");
      const hi = origFoto?.dataset?.hiresUrl || "";
      if (hi && cloneFoto) {
        const img = new Image();
        img.decoding = "sync";
        img.loading = "eager";
        img.src = hi;
        await new Promise((res, rej) => {
          img.onload = res;
          img.onerror = rej;
        });
        cloneFoto.style.backgroundImage = "none";
        cloneFoto.textContent = "";
        Object.assign(img.style, {
          width: "100%",
          height: "100%",
          objectFit: "cover",
          borderRadius: "inherit",
          display: "block",
        });
        cloneFoto.appendChild(img);
      }

      try {
        await document.fonts?.ready;
      } catch (e) {}

      const canvas = await html2canvas(clone, {
        scale: dpi / 96,
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false,
        imageTimeout: 15000,
      });
      return { dataURL: canvas.toDataURL("image/png") };
    } finally {
      document.body.removeChild(host);
      if (versoEl) versoEl.classList.remove("modo-dobra");
    }
  }

  // ==========================================
  // Exportar (PDF/PNG/Imprimir) e Compartilhar
  // ==========================================
  function validarAntesDeExportar() {
    const nome = document.getElementById("nome")?.value.trim();
    if (!nome) {
      alert(
        "⚠️ Por favor, preencha o nome completo antes de gerar a carteirinha.",
      );
      document.getElementById("nome")?.focus();
      return false;
    }

    const overflowWall = document.querySelector(
      ".carteirinha-visual .verso .overflow-wall",
    );
    if (overflowWall) {
      alert(
        "⚠️ A carteirinha está com conteúdo excedente.\n\nReduza o número de itens (alergias, condições ou medicamentos) para caber no espaço disponível.",
      );
      return false;
    }

    return true;
  }

  (function initExportar() {
    const btnExportar = document.getElementById("btn-exportar");
    const menuExportar = document.getElementById("menu-exportar");
    const acaoPDF = document.getElementById("acao-pdf");
    const acaoPNG = document.getElementById("acao-png");
    const acaoPRINT = document.getElementById("acao-print");
    const btnCompartilhar = document.getElementById("btn-compartilhar");

    if (btnExportar && menuExportar) {
      btnExportar.addEventListener("click", () => {
        const hidden = menuExportar.hasAttribute("hidden");
        if (hidden) menuExportar.removeAttribute("hidden");
        else menuExportar.setAttribute("hidden", "");
      });
      document.addEventListener("click", (e) => {
        if (!menuExportar.contains(e.target) && e.target !== btnExportar) {
          menuExportar.setAttribute("hidden", "");
        }
      });
    }

    if (acaoPDF) {
      acaoPDF.addEventListener("click", async () => {
        if (!validarAntesDeExportar()) return;
        try {
          const { dataURL } = await capturarCarteirinhaHiDPI(600);
          const pdf = new jsPDF({
            orientation: "portrait",
            unit: "mm",
            format: [85.6, 108],
          });
          pdf.addImage(dataURL, "PNG", 0, 0, 85.6, 108);
          pdf.save("carteirinha_tasafe.pdf");
          menuExportar?.setAttribute("hidden", "");
        } catch {
          alert("Não foi possível gerar o PDF.");
        }
      });
    }

    if (acaoPNG) {
      acaoPNG.addEventListener("click", async () => {
        if (!validarAntesDeExportar()) return;
        try {
          const { dataURL } = await capturarCarteirinhaHiDPI(450);
          const a = document.createElement("a");
          a.href = dataURL;
          a.download = "carteirinha_tasafe.png";
          a.click();
          menuExportar?.setAttribute("hidden", "");
        } catch {
          alert("Não foi possível gerar a imagem.");
        }
      });
    }

    if (acaoPRINT) {
      acaoPRINT.addEventListener("click", async () => {
        if (!validarAntesDeExportar()) return;
        try {
          const { dataURL } = await capturarCarteirinhaHiDPI(600);
          const iframe = document.createElement("iframe");
          Object.assign(iframe.style, {
            position: "fixed",
            right: "0",
            bottom: "0",
            width: "0",
            height: "0",
            border: "0",
          });
          document.body.appendChild(iframe);
          const html = `
<!doctype html><html><head><meta charset="utf-8"><title>Impressão - TáSafe</title>
<style>
@page { size: A4; margin: 6mm; }
:root { --offset-x: 15mm; --offset-y: 15mm; }
html,body{margin:0;padding:0}
.sheet{display:block;padding-top:var(--offset-y);padding-left:var(--offset-x);}
img#impressao{width:85.6mm;height:108mm;display:block;outline:.2mm dashed #999;}
@media print{button{display:none}}
</style></head><body>
<div class="sheet"><img id="impressao" src="${dataURL}" alt="Carteirinha TáSafe"></div>
<script>
const img=document.getElementById('impressao');
function go(){ setTimeout(()=>{ window.focus(); window.print(); }, 50); }
if(img.complete) go(); else img.addEventListener('load', go);
function done(){ try{ parent.postMessage('tasafe_print_done','*'); }catch(e){} }
window.onafterprint = done; setTimeout(done, 2500);
<\/script></body></html>`.trim();
          iframe.srcdoc = html;
          function handleMsg(e) {
            if (e.data === "tasafe_print_done") {
              window.removeEventListener("message", handleMsg);
              setTimeout(() => document.body.removeChild(iframe), 300);
            }
          }
          window.addEventListener("message", handleMsg);
        } catch {
          alert("Não foi possível preparar a impressão.");
        }
      });
    }

    if (btnCompartilhar) {
      btnCompartilhar.addEventListener("click", async () => {
        try {
          const { dataURL } = await capturarCarteirinhaHiDPI(600);
          const supportsFiles = "canShare" in navigator && "share" in navigator;
          if (supportsFiles) {
            const res = await fetch(dataURL);
            const blob = await res.blob();
            const file = new File([blob], "carteirinha_tasafe.png", {
              type: "image/png",
            });
            if (!navigator.canShare || navigator.canShare({ files: [file] })) {
              await navigator.share({
                title: "TáSafe – Carteirinha",
                text: "Minha carteirinha de saúde TáSafe.",
                files: [file],
              });
              return;
            }
          }
          const w = window.open(dataURL, "_blank", "noopener,noreferrer");
          if (!w)
            alert(
              "Imagem gerada. Desative o bloqueador de pop-ups para abrir em nova aba.",
            );
        } catch {
          alert("Não foi possível preparar o compartilhamento.");
        }
      });
    }
  })();

  // ==========================================
  // Foto: uploader com downscale e validação
  // ==========================================
  (function initFoto() {
    const FOTO_ALLOWED = ["image/jpeg", "image/png", "image/webp"];
    const FOTO_MAX_MB = 3;
    const FOTO_MAX_BYTES = FOTO_MAX_MB * 1024 * 1024;
    const MIN_W = 200,
      MIN_H = 240;
    const DS_TYPE = "image/jpeg";
    const PREV_MAX = 800;
    const HI_MAX = 3600;

    const input = document.getElementById("foto");
    const drop = document.getElementById("foto-dropzone");
    const thumb = document.getElementById("foto-thumb");
    const msg = document.getElementById("foto-msg");
    const btnEscolher = document.getElementById("btn-foto-escolher");
    const btnRemover = document.getElementById("btn-foto-remover");
    const prev = document.getElementById("foto-preview");
    if (
      !input ||
      !drop ||
      !thumb ||
      !msg ||
      !btnEscolher ||
      !btnRemover ||
      !prev
    )
      return;

    let fotoPreviewURL = null;
    let fotoHiURL = null;

    function freeURL(u) {
      if (u && u.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(u);
        } catch (e) {}
      }
    }
    function setMsg(text, type = "") {
      msg.textContent = text || "";
      msg.className = "foto-msg" + (type ? " " + type : "");
    }
    function humanSize(b) {
      if (b < 1024) return b + " B";
      if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
      return (b / 1048576).toFixed(1) + " MB";
    }

    async function downscaleImageFile(
      file,
      { maxW = HI_MAX, maxH = HI_MAX, type = DS_TYPE, quality = 0.9 } = {},
    ) {
      const url = URL.createObjectURL(file);
      try {
        const img = await new Promise((res, rej) => {
          const i = new Image();
          i.onload = () => res(i);
          i.onerror = rej;
          i.src = url;
        });
        const w = img.naturalWidth,
          h = img.naturalHeight;
        const ratio = Math.min(maxW / w, maxH / h, 1);
        const cw = Math.round(w * ratio),
          ch = Math.round(h * ratio);
        if (ratio === 1 && file.type === "image/jpeg") {
          return {
            blob: file,
            url: URL.createObjectURL(file),
            width: w,
            height: h,
          };
        }
        const canvas = Object.assign(document.createElement("canvas"), {
          width: cw,
          height: ch,
        });
        const ctx = canvas.getContext("2d", { alpha: false });
        ctx.drawImage(img, 0, 0, cw, ch);
        const blob = await new Promise((resolve) =>
          canvas.toBlob(resolve, type, quality),
        );
        if (!blob) throw new Error("Falha ao gerar imagem.");
        return { blob, url: URL.createObjectURL(blob), width: cw, height: ch };
      } finally {
        URL.revokeObjectURL(url);
      }
    }

    async function medirDim(file) {
      const tmp = URL.createObjectURL(file);
      try {
        return await new Promise((res) => {
          const img = new Image();
          img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = () => res(null);
          img.src = tmp;
        });
      } finally {
        URL.revokeObjectURL(tmp);
      }
    }

    function aplicarPreview(url) {
      thumb.style.backgroundImage = `url(${url})`;
      thumb.textContent = "";
      prev.style.backgroundImage = `url(${url})`;
      prev.textContent = "";
      btnRemover.disabled = false;
      btnEscolher.textContent = "Substituir foto";
    }

    function limparFoto(showNotice = false) {
      input.value = "";
      freeURL(fotoPreviewURL);
      freeURL(fotoHiURL);
      fotoPreviewURL = null;
      fotoHiURL = null;
      delete prev.dataset.hiresUrl;
      delete prev.dataset.previewUrl;
      thumb.style.backgroundImage = "";
      thumb.textContent = "FOTO";
      prev.style.backgroundImage = "";
      prev.textContent = "FOTO";
      btnRemover.disabled = true;
      btnEscolher.textContent = "Selecionar foto";
      if (showNotice) setMsg("Foto removida.");
    }

    async function gerarVariantes(file) {
      const dim = await medirDim(file);
      if (!dim) throw new Error("Não foi possível ler a imagem.");
      if (dim.w < MIN_W || dim.h < MIN_H)
        throw new Error(`Imagem muito pequena. Mínimo ${MIN_W}×${MIN_H}px.`);

      const preview = await downscaleImageFile(file, {
        maxW: PREV_MAX,
        maxH: PREV_MAX,
        type: "image/jpeg",
        quality: 0.9,
      });

      const longSide = Math.max(dim.w, dim.h);
      let hires;
      if (
        file.size <= 7 * 1024 * 1024 &&
        longSide <= 3500 &&
        file.type === "image/jpeg"
      ) {
        hires = { blob: file, url: URL.createObjectURL(file) };
      } else {
        hires = await downscaleImageFile(file, {
          maxW: HI_MAX,
          maxH: HI_MAX,
          type: "image/jpeg",
          quality: 0.95,
        });
      }

      if (hires.blob.size > FOTO_MAX_BYTES) {
        URL.revokeObjectURL(hires.url);
        hires = await downscaleImageFile(file, {
          maxW: HI_MAX,
          maxH: HI_MAX,
          type: "image/jpeg",
          quality: 0.92,
        });
        if (hires.blob.size > FOTO_MAX_BYTES) {
          URL.revokeObjectURL(hires.url);
          hires = await downscaleImageFile(file, {
            maxW: HI_MAX,
            maxH: HI_MAX,
            type: "image/jpeg",
            quality: 0.9,
          });
          if (hires.blob.size > FOTO_MAX_BYTES) {
            URL.revokeObjectURL(hires.url);
            throw new Error(
              `A imagem ficou com ${humanSize(hires.blob.size)} após compactar (máx. ${FOTO_MAX_MB} MB). Tente uma foto menor.`,
            );
          }
        }
      }
      return { preview, hires, dim };
    }

    async function validarECarregar(file) {
      if (!FOTO_ALLOWED.includes(file.type)) {
        setMsg("Formato não suportado. Use PNG, JPG ou WebP.", "error");
        return;
      }
      try {
        const { preview, hires } = await gerarVariantes(file);
        if (fotoPreviewURL) URL.revokeObjectURL(fotoPreviewURL);
        if (fotoHiURL) URL.revokeObjectURL(fotoHiURL);
        fotoPreviewURL = preview.url;
        fotoHiURL = hires.url;
        prev.dataset.previewUrl = fotoPreviewURL;
        prev.dataset.hiresUrl = fotoHiURL;
        aplicarPreview(fotoPreviewURL);
        setMsg(
          `Foto preparada (${(preview.blob.size / 1024).toFixed(0)} KB • exp: ${(hires.blob.size / 1024).toFixed(0)} KB).`,
          "success",
        );
      } catch (e) {
        console.error(e);
        setMsg(e.message || "Não foi possível processar a imagem.", "error");
      }
    }

    btnEscolher.addEventListener("click", () => input.click());
    btnRemover.addEventListener("click", () => limparFoto(true));
    input.addEventListener("change", () => {
      const f = input.files && input.files[0];
      if (f) validarECarregar(f);
    });

    ["dragenter", "dragover"].forEach((ev) =>
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        e.stopPropagation();
        drop.classList.add("is-dragover");
      }),
    );
    ["dragleave", "dragend", "drop"].forEach((ev) =>
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        e.stopPropagation();
        drop.classList.remove("is-dragover");
      }),
    );
    drop.addEventListener("drop", (e) => {
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) validarECarregar(f);
    });
    drop.addEventListener("click", (e) => {
      if (!e.target.closest("button")) input.click();
    });
    drop.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        input.click();
      }
    });

    limparFoto(false);
  })();

  // ==========================================
  // Preview principal (espelhos simples)
  // ==========================================
  function atualizarPreview() {
    const nome = capitalizarTexto(document.getElementById("nome")?.value || "");
    const susDigits = apenasDigitos(
      document.getElementById("sus")?.value || "",
    );
    const susFmt = formatarSUS(susDigits);
    const nascRaw = document.getElementById("nascimento")?.value || "";
    const nascFmt = nascRaw ? nascRaw.split("-").reverse().join("/") : "";
    const sangue = document.getElementById("sangue")?.value || "";
    const tipoNode = document.querySelector(".linha-dupla .tipo-sangue");

    if (tipoNode) {
      if (SANGUE_HIDE_VALUES.includes(sangue)) {
        tipoNode.style.display = "none";
      } else {
        tipoNode.style.display = "";
        document
          .getElementById("sangue-prev")
          ?.appendChild(document.createTextNode("")); // noop para garantir nó
        document.getElementById("sangue-prev").textContent = sangue;
      }
    }

    document.getElementById("nome-prev") &&
      (document.getElementById("nome-prev").textContent = orDefault(nome));
    fitNome();
    document.getElementById("sus-prev") &&
      (document.getElementById("sus-prev").textContent = orDefault(susFmt));
    document.getElementById("nasc-prev") &&
      (document.getElementById("nasc-prev").textContent = orDefault(nascFmt));

    // Contatos no verso
    setRotuloPlural(
      "contato-prev",
      "Contato de Emergência",
      "Contatos de Emergência",
      contatos.length,
    );
    const contatosHtml = contatos.length
      ? contatos
          .map((c) => `${esc(c.nome)} – ${esc(formatarFoneBR(c.digs))}`)
          .join("<br>")
      : "";
    const contatoEl = document.getElementById("contato-prev");
    if (contatoEl) {
      if (contatosHtml) {
        contatoEl.innerHTML = contatosHtml;
      } else {
        contatoEl.textContent = PREVIEW_DEFAULT;
      }
    }

    scheduleFlowRecalc();
  }

  // Mantém frente/verso com metade da altura do cartão (para o preview em tela)
  function lockPreviewHeights() {
    const card = document.getElementById("carteirinha");
    const frente = document.querySelector(".carteirinha-visual .frente");
    const verso = document.querySelector(".carteirinha-visual .verso");
    if (!card || !frente || !verso) return;
    const half = Math.round(card.clientHeight / 2); // 408px/2 = 204px
    frente.style.height = half + "px";
    verso.style.height = half + "px";
  }
  // já aplica agora e reaplica em resize
  lockPreviewHeights();
  window.addEventListener("resize", lockPreviewHeights);

  // Verso: esconde "Medicamentos..." (rótulo + lista) quando vazio
  (function hideBackMedsOnLoad() {
    const verso = document.querySelector(".verso");
    if (!verso) return;
    const labelP = Array.from(verso.querySelectorAll("p")).find((p) => {
      const st = p.querySelector("strong");
      return st && /Medicamentos de uso contínuo/i.test(st.textContent || "");
    });
    if (labelP) labelP.style.display = "none";
    const listP = document.getElementById("medicamentos-prev");
    if (listP) listP.style.display = "none";
  })();

  // Inicializações de espelho simples
  ["nome", "sus", "nascimento", "sangue"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", atualizarPreview);
  });
  document
    .getElementById("sangue")
    ?.addEventListener("change", atualizarPreview);

  // ==========================================
  // SUS: máscara em tempo real
  // ==========================================
  (function initSUS() {
    const el = document.getElementById("sus");
    if (!el) return;

    function setCaretByDigitIndex(digitIdx, totalDigits) {
      const safe = Math.min(digitIdx, totalDigits);
      const caret = caretIndexFromDigitIndex(safe);
      requestAnimationFrame(() => el.setSelectionRange(caret, caret));
    }

    const paint = () => {
      const digits = apenasDigitos(el.value);
      el.classList.remove("is-valid", "is-invalid");
      if (digits.length === 0) return;
      if (digits.length === 15) el.classList.add("is-valid");
      else el.classList.add("is-invalid");
    };

    el.addEventListener("input", () => {
      const raw = el.value;
      const digits = apenasDigitos(raw).slice(0, 15);
      const oldStart = el.selectionStart ?? raw.length;
      const digitPos = countDigitsBefore(raw, oldStart);
      el.value = formatarSUS(digits);
      setCaretByDigitIndex(digitPos, digits.length);
      paint();
      atualizarPreview();
    });

    el.addEventListener("keydown", (e) => {
      const ok = [
        "Backspace",
        "Delete",
        "ArrowLeft",
        "ArrowRight",
        "Tab",
        "Home",
        "End",
      ];
      if (ok.includes(e.key)) return;
      if (/^\d$/.test(e.key)) {
        const digits = apenasDigitos(el.value);
        const selLen = (el.selectionEnd ?? 0) - (el.selectionStart ?? 0);
        if (digits.length >= 15 && selLen === 0) e.preventDefault();
        return;
      }
      e.preventDefault();
    });

    el.addEventListener("paste", (e) => {
      e.preventDefault();
      const clip =
        (e.clipboardData || window.clipboardData).getData("text") || "";
      const pasteDigits = apenasDigitos(clip);
      if (!pasteDigits) return;
      const cur = el.value;
      const totalDigits = apenasDigitos(cur);
      const selStart = el.selectionStart ?? cur.length;
      const selEnd = el.selectionEnd ?? selStart;
      const startD = countDigitsBefore(cur, selStart);
      const endD = countDigitsBefore(cur, selEnd);
      let newDigits =
        totalDigits.slice(0, startD) + pasteDigits + totalDigits.slice(endD);
      newDigits = newDigits.slice(0, 15);
      el.value = formatarSUS(newDigits);
      const newDigitCaret = Math.min(
        startD + pasteDigits.length,
        newDigits.length,
      );
      setCaretByDigitIndex(newDigitCaret, newDigits.length);
      paint();
      atualizarPreview();
    });

    // Estado inicial
    (function init() {
      const d = apenasDigitos(el.value).slice(0, 15);
      el.value = formatarSUS(d);
      paint();
    })();
  })();

  // ==========================================
  // Telefone do contato
  // ==========================================
  (function initTelefone() {
    const el = document.getElementById("contatoFone");
    if (!el) return;

    const sanitize = () => {
      let v = apenasDigitos(el.value);
      if (v.length > 11) v = v.slice(0, 11);
      el.value = formatarFoneBR(v);
    };

    const paint = () => {
      const digits = apenasDigitos(el.value);
      el.classList.remove("is-valid", "is-invalid");
      if (digits.length === 0) return;
      if (foneValido(digits)) el.classList.add("is-valid");
      else el.classList.add("is-invalid");
    };

    el.addEventListener("keydown", (e) => {
      const btnAdd = document.getElementById("btn-add-contato");
      const okKeys = [
        "Backspace",
        "Delete",
        "ArrowLeft",
        "ArrowRight",
        "Tab",
        "Home",
        "End",
        "Enter",
      ];
      if (e.key === "Enter") {
        e.preventDefault();
        btnAdd?.click();
        return;
      }
      if (okKeys.includes(e.key)) return;
      if (/^\d$/.test(e.key)) {
        const selLen = (el.selectionEnd ?? 0) - (el.selectionStart ?? 0);
        const digits = apenasDigitos(el.value);
        if (digits.length >= 11 && selLen === 0) e.preventDefault();
        return;
      }
      e.preventDefault();
    });

    // Enter no nome também adiciona
    (function enableEnterToAddContato() {
      const nome = document.getElementById("contatoNome");
      const btnAdd = document.getElementById("btn-add-contato");
      if (!nome || !btnAdd) return;
      nome.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          btnAdd.click();
        }
      });
    })();

    const onInput = () => {
      sanitize();
      paint();
      atualizarPreview();
    };
    el.addEventListener("input", onInput);
    el.addEventListener("blur", () => {
      paint();
      atualizarPreview();
    });
    el.addEventListener("paste", (e) => {
      e.preventDefault();
      const text =
        (e.clipboardData || window.clipboardData).getData("text") || "";
      const digits = apenasDigitos(text).slice(0, 11);
      document.execCommand("insertText", false, digits);
    });

    sanitize();
    paint();
  })();

  // ==========================================
  // Contatos: add/editar/remover
  // ==========================================
  (function initContatoNomeLimit() {
    const input = document.getElementById("contatoNome");
    if (!input) return;
    input.setAttribute("maxlength", String(CONTATO_NOME_MAX));

    let composing = false;
    input.addEventListener("compositionstart", () => {
      composing = true;
    });
    input.addEventListener("compositionend", () => {
      composing = false;
      const v = input.value.normalize("NFC");
      if (v.length > CONTATO_NOME_MAX) {
        input.value = v.slice(0, CONTATO_NOME_MAX);
        setContatoMsg(`Limite de ${CONTATO_NOME_MAX} caracteres.`, "warn");
      }
    });
    input.addEventListener("beforeinput", (e) => {
      if (composing) return;
      const t = e.inputType || "";
      if (t.startsWith("delete") || t === "historyUndo" || t === "historyRedo")
        return;
      const v = input.value.normalize("NFC");
      const start = input.selectionStart ?? v.length;
      const end = input.selectionEnd ?? start;
      const ins = (e.data ?? "").normalize("NFC");
      if (!ins) return;
      const nextLen = v.length - (end - start) + ins.length;
      if (nextLen > CONTATO_NOME_MAX) {
        e.preventDefault();
        setContatoMsg(`Limite de ${CONTATO_NOME_MAX} caracteres.`, "warn");
      }
    });
    input.addEventListener("paste", (e) => {
      e.preventDefault();
      const text =
        (e.clipboardData || window.clipboardData).getData("text") || "";
      const allowed = text.slice(0, CONTATO_NOME_MAX - input.value.length);
      document.execCommand("insertText", false, allowed);
      if (text.length > allowed.length)
        setContatoMsg(`Limite de ${CONTATO_NOME_MAX} caracteres.`, "warn");
    });
    input.addEventListener("input", () => {
      const v = input.value.normalize("NFC");
      if (v.length > CONTATO_NOME_MAX) {
        input.value = v.slice(0, CONTATO_NOME_MAX);
        setContatoMsg(`Limite de ${CONTATO_NOME_MAX} caracteres.`, "warn");
      } else {
        const el = document.getElementById("contato-msg");
        if (el && /\blimite de \d+ caracteres/i.test(el.textContent))
          setContatoMsg("");
      }
    });
  })();

  function renderContatos() {
    const box = document.getElementById("contatos-lista");
    if (!box) return;
    box.innerHTML = "";
    contatos.forEach((c, idx) => {
      const div = document.createElement("div");
      div.className = "contato-card";
      const nomeTxt = esc(c.nome);
      const foneFmt = formatarFoneBR(c.digs);
      const title = `${c.nome} – ${foneFmt}`;
      div.innerHTML = `
        <div class="info" title="${esc(title)}">
          <span class="nome">${nomeTxt}</span><span class="sep">–</span><span class="fone">${esc(foneFmt)}</span>
        </div>
        <div class="acoes">
          <button type="button" class="btn-editar">Editar</button>
          <button type="button" class="btn-remover">Remover</button>
        </div>
      `;
      div.querySelector(".btn-editar").addEventListener("click", () => {
        const nomeEl = document.getElementById("contatoNome");
        const foneEl = document.getElementById("contatoFone");
        if (!nomeEl || !foneEl) return;
        editingIndex = idx;
        nomeEl.value = c.nome;
        foneEl.value = formatarFoneBR(c.digs);
        document.getElementById("btn-add-contato").textContent =
          "Salvar contato";
        setContatoMsg("Editando contato. Faça as alterações e salve.", "");
        nomeEl.focus();
      });
      div.querySelector(".btn-remover").addEventListener("click", () => {
        if (editingIndex === idx) {
          editingIndex = null;
          document.getElementById("btn-add-contato").textContent =
            "Adicionar contato";
          document
            .getElementById("contatoNome")
            ?.classList.remove("is-valid", "is-invalid");
          document.getElementById("contatoNome").value = "";
          document.getElementById("contatoFone").value = "";
        }
        contatos.splice(idx, 1);
        renderContatos();
        atualizarPreview();
        setContatoMsg("Contato removido.", "success");
      });
      box.appendChild(div);
    });
  }

  function handleSubmitContato() {
    const nomeEl = document.getElementById("contatoNome");
    const foneEl = document.getElementById("contatoFone");
    if (!nomeEl || !foneEl) return;

    const nome = capitalizarTexto((nomeEl.value || "").trim());
    const digs = apenasDigitos(foneEl.value || "");

    if (!nome) {
      nomeEl.classList.add("is-invalid");
      setContatoMsg("Informe o nome do contato.", "error");
      return;
    }
    if (nome.length > CONTATO_NOME_MAX) {
      setContatoMsg(
        `Nome muito longo (máx. ${CONTATO_NOME_MAX} caracteres).`,
        "error",
      );
      return;
    }
    if (!foneValido(digs)) {
      setContatoMsg(
        "Telefone inválido. Use DDD + número (10–11 dígitos).",
        "error",
      );
      return;
    }

    const dup = contatos.findIndex(
      (c, i) => c.digs === digs && i !== editingIndex,
    );
    if (dup !== -1) {
      setContatoMsg("Este telefone já foi adicionado.", "warn");
      return;
    }

    if (editingIndex === null) {
      if (contatos.length >= 3) {
        setContatoMsg("Máximo de 3 contatos.", "warn");
        return;
      }
      contatos.push({ nome, digs });
      setContatoMsg("Contato adicionado.", "success");
    } else {
      contatos[editingIndex] = { nome, digs };
      editingIndex = null;
      document.getElementById("btn-add-contato").textContent =
        "Adicionar contato";
      setContatoMsg("Contato atualizado.", "success");
    }

    nomeEl.value = "";
    foneEl.value = "";
    nomeEl.classList.add("is-valid");
    renderContatos();
    atualizarPreview();
  }
  document
    .getElementById("btn-add-contato")
    ?.addEventListener("click", handleSubmitContato);

  // ==========================================
  // Nome do portador: limite 40 (UX)
  // ==========================================
  (function setupNomeDoPortadorLimit() {
    const NOME_MAX_LEN = 40;
    const input = document.getElementById("nome");
    if (!input) return;
    let msgEl = input.closest(".campo")?.querySelector(".field-msg");
    if (!msgEl) {
      msgEl = document.createElement("div");
      msgEl.className = "field-msg";
      input.closest(".campo")?.appendChild(msgEl);
    }
    let timer = null;
    function showFieldMsg(txt, type = "warn", ms = 1800) {
      msgEl.textContent = txt || "";
      msgEl.className = "field-msg " + (type || "");
      clearTimeout(timer);
      if (ms)
        timer = setTimeout(() => {
          msgEl.textContent = "";
          msgEl.className = "field-msg";
        }, ms);
    }
    input.addEventListener("beforeinput", (e) => {
      if (!(e.inputType || "").startsWith("insert")) return;
      const ins = e.data || "";
      if (!ins) return;
      const selLen = (input.selectionEnd ?? 0) - (input.selectionStart ?? 0);
      const lenSemSelecao = input.value.length - selLen;
      if (lenSemSelecao >= NOME_MAX_LEN) {
        e.preventDefault();
        showFieldMsg(`Limite de ${NOME_MAX_LEN} caracteres.`, "warn");
      }
    });
    input.addEventListener("paste", (e) => {
      e.preventDefault();
      const text =
        (e.clipboardData || window.clipboardData).getData("text") || "";
      const allowed = text.slice(0, NOME_MAX_LEN - input.value.length);
      document.execCommand("insertText", false, allowed);
      if (text.length > allowed.length)
        showFieldMsg(`Limite de ${NOME_MAX_LEN} caracteres.`, "warn");
    });
    input.addEventListener("input", () => {
      if (input.value.length > NOME_MAX_LEN) {
        input.value = input.value.slice(0, NOME_MAX_LEN);
        showFieldMsg(`Limite de ${NOME_MAX_LEN} caracteres.`, "warn");
      }
    });
  })();

  // ==========================================
  // Chips com autocomplete (3 campos)
  // ==========================================
  const SUG_ALERGIAS = [
    "Amendoim",
    "Castanha-de-caju",
    "Castanha-do-pará",
    "Nozes",
    "Amêndoas",
    "Pistache",
    "Avelã",
    "Leite de vaca",
    "Lactose",
    "Ovo",
    "Soja",
    "Trigo",
    "Glúten",
    "Peixe",
    "Camarão",
    "Frutos do mar",
    "Mariscos",
    "Crustáceos",
    "Morango",
    "Banana",
    "Kiwi",
    "Tomate",
    "Chocolate",
    "Gergelim",
    "Mostarda",
    "Milho",
    "Gramíneas",
    "Mofo",
    "Fungos",
    "Pelos de animais",
    "Látex",
    "Níquel",
    "Perfumes",
    "Cosméticos",
    "Detergentes",
    "Cloro",
    "Tintas",
    "Resinas epóxi",
    "Picada de abelha",
    "Picada de vespa",
    "Formiga",
    "Barata",
    "Penicilina",
    "Amoxicilina",
    "Cefalosporinas",
    "Sulfas (SMX-TMP)",
    "AAS (Aspirina)",
    "Ibuprofeno",
    "Naproxeno",
    "Diclofenaco",
    "Cetoprofeno",
    "Dipirona (Metamizol)",
    "Paracetamol",
    "Loratadina",
    "Dexclorfeniramina",
    "Contraste iodado",
    "Iodo",
    "Clorexidina",
    "Lidocaína",
    "Neomicina",
    "Polimixina B",
    "Vacinas (reação prévia)",
    "Adesivos (cola)",
  ];
  const SUG_CONDICOES = [
    "Asma",
    "Rinite alérgica",
    "Sinusite crônica",
    "DPOC",
    "Bronquite crônica",
    "Apneia do sono",
    "Diabetes tipo 1",
    "Diabetes tipo 2",
    "Pré-diabetes",
    "Hipotireoidismo",
    "Hipertireoidismo",
    "Dislipidemia",
    "Gota (ácido úrico)",
    "Obesidade",
    "Osteopenia",
    "Osteoporose",
    "Hipertensão arterial",
    "Arritmia",
    "Insuficiência cardíaca",
    "Doença coronariana",
    "Histórico de infarto (IAM)",
    "Marcapasso",
    "Valvopatia",
    "Trombose venosa",
    "Varizes",
    "Epilepsia",
    "Enxaqueca",
    "AVC prévio",
    "Parkinson",
    "Esclerose múltipla",
    "Neuropatia periférica",
    "Refluxo (DRGE)",
    "Gastrite",
    "Úlcera péptica",
    "Doença celíaca",
    "Doença de Crohn",
    "Retocolite ulcerativa",
    "Intolerância à lactose",
    "SII",
    "Doença renal crônica",
    "Cálculo renal",
    "HPB",
    "Esteatose hepática",
    "Hepatite B",
    "Hepatite C",
    "Anemia ferropriva",
    "Anemia falciforme",
    "Trombofilia",
    "Lúpus (LES)",
    "Artrite reumatoide",
    "Psoríase",
    "Doença autoimune (outras)",
    "Glaucoma",
    "Catarata",
    "Conjuntivite alérgica",
    "Dermatite atópica",
    "Urticária crônica",
    "Dermatite de contato",
    "Vitiligo",
    "Ansiedade",
    "Depressão",
    "Transtorno bipolar",
    "TDAH",
    "TEA",
    "Alergia a AINEs",
    "Gestante",
    "Puerpério recente",
    "Imunossupressão",
    "Transplante (órgão sólido)",
    "Quimioterapia em curso",
  ];
  const SUG_MEDICAMENTOS = [
    "Paracetamol",
    "Dipirona (Metamizol)",
    "Ibuprofeno",
    "Naproxeno",
    "Diclofenaco",
    "Cetoprofeno",
    "AAS (Aspirina)",
    "Codeína",
    "Tramadol",
    "Loratadina",
    "Desloratadina",
    "Cetirizina",
    "Fexofenadina",
    "Dexclorfeniramina",
    "Prednisona",
    "Prednisolona",
    "Hidrocortisona (tópica)",
    "Salbutamol (spray)",
    "Fenoterol (spray)",
    "Formoterol",
    "Budesonida (inalatória)",
    "Beclometasona (inalatória)",
    "Fluticasona (inalatória)",
    "Montelucaste",
    "Ondansetrona",
    "Metoclopramida",
    "Dimenidrinato",
    "Omeprazol",
    "Pantoprazol",
    "Esomeprazol",
    "Lansoprazol",
    "Domperidona",
    "Escopolamina (Butilbrometo)",
    "Hioscina",
    "Mosaprida",
    "Losartana",
    "Valsartana",
    "Olmesartana",
    "Captopril",
    "Enalapril",
    "Ramipril",
    "Amlodipino",
    "Nifedipino",
    "Verapamil",
    "Diltiazem",
    "Atenolol",
    "Metoprolol",
    "Carvedilol",
    "Propranolol",
    "Hidroclorotiazida",
    "Clortalidona",
    "Furosemida",
    "Espironolactona",
    "Sinvastatina",
    "Atorvastatina",
    "Rosuvastatina",
    "Ezetimiba",
    "Clopidogrel",
    "Varfarina",
    "Rivaroxabana",
    "Apixabana",
    "Metformina",
    "Glicazida",
    "Glibenclamida",
    "Insulina NPH",
    "Insulina Regular",
    "Insulina Glargina",
    "Insulina Detemir",
    "Insulina Lispro",
    "Insulina Aspart",
    "Levotiroxina",
    "Sertralina",
    "Fluoxetina",
    "Escitalopram",
    "Venlafaxina",
    "Bupropiona",
    "Clonazepam",
    "Diazepam",
    "Alprazolam",
    "Amitriptilina",
    "Carbamazepina",
    "Valproato de sódio",
    "Lamotrigina",
    "Levetiracetam",
    "Quetiapina",
    "Olanzapina",
    "Risperidona",
    "Amoxicilina",
    "Amoxicilina + Clavulanato",
    "Azitromicina",
    "Claritromicina",
    "Cefalexina",
    "Ceftriaxona",
    "Ciprofloxacino",
    "Levofloxacino",
    "Sulfametoxazol + Trimetoprim",
    "Nitrofurantoína",
    "Doxiciclina",
    "Fluconazol",
    "Itraconazol",
    "Nistatina",
    "Aciclovir",
    "Alopurinol",
    "Colchicina",
    "Sulfassalazina",
    "Ferrossulfato",
    "Ácido fólico",
    "Vitamina D",
    "Contraceptivo combinado",
    "Levonorgestrel",
    "TRH",
    "PREP",
  ];

  function setupChipField({
    inputId,
    addBtnId,
    chipsBoxId,
    previewId,
    suggestions = [],
  }) {
    const input = document.getElementById(inputId);
    const addBtn = document.getElementById(addBtnId);
    const chipsBox = document.getElementById(chipsBoxId);
    const prev = document.getElementById(previewId);
    if (!input || !addBtn || !chipsBox || !prev) return;

    if (chipsBox.dataset.inited === "1") return;
    chipsBox.dataset.inited = "1";

    let items = [];

    // Mensagem abaixo do campo
    let msgEl = document.createElement("div");
    msgEl.className = "chip-msg";
    chipsBox.parentElement.appendChild(msgEl);
    let msgTimer = null;
    function showMsg(text, type = "info") {
      if (!msgEl) return;
      msgEl.textContent = text;
      msgEl.className = "chip-msg " + type;
      clearTimeout(msgTimer);
      msgTimer = setTimeout(() => {
        msgEl.textContent = "";
        msgEl.className = "chip-msg";
      }, MSG_TIMEOUT);
    }

    function canonical(s) {
      return (s || "")
        .toLocaleLowerCase("pt-BR")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    }
    function sanitize(text) {
      return capitalizarTexto(
        (text || "").replace(/\s+/g, " ").replace(/[;]+/g, ";").trim(),
      );
    }

    if (!input.hasAttribute("maxlength")) {
      input.setAttribute("maxlength", String(CHIP_MAX_LEN));
      input.addEventListener("input", () => {
        const val = input.value || "";
        if (val.length === CHIP_MAX_LEN)
          showMsg(`Você atingiu ${CHIP_MAX_LEN} caracteres.`, "warn");
      });
    }

    // Autocomplete
    const inputWrap = input.closest(".chip-input-wrap") || input.parentElement;
    if (inputWrap && getComputedStyle(inputWrap).position === "static") {
      inputWrap.style.position = "relative";
    }
    const dd = document.createElement("div");
    dd.className = "chip-suggest";
    dd.setAttribute("role", "listbox");
    dd.hidden = true;
    inputWrap.appendChild(dd);

    let activeIndex = -1;
    let currentList = [];

    function buscarSugestoes(q) {
      const key = canonical(q);
      if (!key) return [];
      const notInItems = (s) =>
        !items.some((it) => canonical(it) === canonical(s));
      const pool = suggestions.filter(notInItems);
      const scored = pool
        .map((s) => {
          const c = canonical(s);
          const score = c.startsWith(key) ? 0 : c.includes(key) ? 1 : 2;
          return { s, c, score };
        })
        .filter((o) => o.score < 2);
      scored.sort((a, b) => a.score - b.score || a.c.localeCompare(b.c));
      return scored.map((o) => o.s).slice(0, 6);
    }

    function renderDropdown(list) {
      currentList = list;
      activeIndex = list.length ? 0 : -1;
      if (!list.length) {
        dd.hidden = true;
        dd.innerHTML = "";
        input.setAttribute("aria-expanded", "false");
        return;
      }
      dd.innerHTML = list
        .map(
          (t, i) => `
        <div class="sug-item ${i === 0 ? "is-active" : ""}"
            role="option"
            id="${inputId}-opt-${i}"
            aria-selected="${i === 0 ? "true" : "false"}"
            title="${esc(t)}">
          ${esc(t)}
        </div>
      `,
        )
        .join("");
      dd.hidden = false;
      input.setAttribute("aria-expanded", "true");
    }

    function moveActive(dir) {
      if (dd.hidden || !currentList.length) return;
      activeIndex =
        (activeIndex + dir + currentList.length) % currentList.length;
      [...dd.children].forEach((el, i) => {
        el.classList.toggle("is-active", i === activeIndex);
        el.setAttribute("aria-selected", i === activeIndex ? "true" : "false");
      });
    }
    function pickActive() {
      if (dd.hidden || activeIndex < 0 || !currentList[activeIndex])
        return false;
      const value = currentList[activeIndex];
      addItem(value, true);
      return true;
    }
    function closeDropdown() {
      dd.hidden = true;
      dd.innerHTML = "";
      input.setAttribute("aria-expanded", "false");
      activeIndex = -1;
      currentList = [];
    }
    dd.addEventListener("mousedown", (e) => {
      const el = e.target.closest(".sug-item");
      if (!el) return;
      const idx = [...dd.children].indexOf(el);
      if (idx >= 0) {
        addItem(currentList[idx], true);
        e.preventDefault();
      }
    });
    input.addEventListener("input", () => {
      const q = input.value;
      if (!q.trim()) {
        closeDropdown();
        return;
      }
      renderDropdown(buscarSugestoes(q));
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        moveActive(+1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        moveActive(-1);
      } else if (e.key === "Enter") {
        if (!dd.hidden && activeIndex >= 0) {
          e.preventDefault();
          pickActive();
        } else {
          e.preventDefault();
          addItem();
        }
      } else if (e.key === "Tab") {
        if (!dd.hidden && activeIndex >= 0) {
          pickActive();
        }
        closeDropdown();
      } else if (e.key === "Escape") {
        closeDropdown();
      }
    });
    input.addEventListener("blur", () => {
      setTimeout(closeDropdown, 120);
    });
    document.addEventListener("click", (e) => {
      if (!dd.contains(e.target) && e.target !== input) closeDropdown();
    });

    // Render dos chips e preview
    function renderListPlain(container, itemsArr) {
      if (!container) return;
      container.innerHTML = "";
      const list = (itemsArr || [])
        .map((s) => (s ?? "").trim())
        .filter(Boolean);
      if (!list.length) {
        container.textContent = PREVIEW_DEFAULT;
        return;
      }
      const frag = document.createDocumentFragment();
      list.forEach((txt) => {
        const s = document.createElement("span");
        s.className = "chip-li";
        s.textContent = txt;
        frag.appendChild(s);
      });
      container.appendChild(frag);
    }

    const render = () => {
      chipsBox.innerHTML = "";
      items.forEach((txt, idx) => {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.innerHTML = `
          <span class="chip-text">${esc(txt)}</span>
          <button type="button" class="chip-x" aria-label="Remover">×</button>
        `;
        chip.querySelector(".chip-x").addEventListener("click", () => {
          items.splice(idx, 1);
          render();
          showMsg("Removido.", "info");
        });
        chipsBox.appendChild(chip);
      });
      renderListPlain(prev, items);
      scheduleFlowRecalc();
    };

    function addItem(fromText, fromSuggest = false) {
      const raw = typeof fromText === "string" ? fromText : input.value;
      const val = sanitize(raw);
      const key = canonical(val);
      if (!key) return;
      if (val.length > CHIP_MAX_LEN) {
        showMsg(`Limite de ${CHIP_MAX_LEN} caracteres por item.`, "error");
        return;
      }
      const jaTem = items.some((it) => canonical(it) === key);
      if (jaTem) {
        showMsg(`“${val}” já foi adicionado.`, "warn");
        input.select();
        return;
      }
      items.push(val);
      render();
      showMsg(fromSuggest ? "Sugestão adicionada." : "Adicionado.", "success");
      input.value = "";
      closeDropdown();
      input.focus();
    }

    addBtn.addEventListener("click", () => addItem());
    render();
  }

  // Inicializa os três campos de chips
  setupChipField({
    inputId: "alergias",
    addBtnId: "add-alergia",
    chipsBoxId: "alergias-chips",
    previewId: "alergias-prev",
    suggestions: SUG_ALERGIAS,
  });
  setupChipField({
    inputId: "condicoes",
    addBtnId: "add-condicao",
    chipsBoxId: "condicoes-chips",
    previewId: "condicoes-prev",
    suggestions: SUG_CONDICOES,
  });
  setupChipField({
    inputId: "medicamentos",
    addBtnId: "add-medicamento",
    chipsBoxId: "medicamentos-chips",
    previewId: "medicamentos-prev",
    suggestions: SUG_MEDICAMENTOS,
  });

  // ==========================================
  // Fluxo frente → verso (excedentes)
  // ==========================================
  const OVERFLOW = { alergias: [], condicoes: [], medicamentos: [] };

  // Cria (uma única vez) o parágrafo de Medicamentos na FRENTE e retorna o <p>
  function ensureFrontMedicamentos() {
    let p = document.getElementById("meds-front-p");
    if (p) return p;

    const condP =
      document.getElementById("condicoes-prev")?.closest("p") ||
      document.getElementById("alergias-prev")?.closest("p");
    if (!condP) return null;

    p = document.createElement("p");
    p.id = "meds-front-p";
    p.innerHTML =
      '<strong>Medicamentos de uso contínuo:</strong> <span id="medicamentos-front"></span>';
    condP.parentNode.insertBefore(p, condP.nextSibling);
    return p;
  }

  function readItemsFromChips(boxId) {
    const chips = document.querySelectorAll(`#${boxId} .chip .chip-text`);
    const out = [];
    chips.forEach((ch) => {
      const txt = (ch.textContent || "").trim();
      if (txt) out.push(txt);
    });
    return out;
  }

  function clearVersoContinuacao() {
    document.querySelectorAll(".verso-continua").forEach((n) => n.remove());
  }

  function addVersoContinuacao(titulo, itens) {
    if (!itens || !itens.length) return;
    const medsP = document.getElementById("medicamentos-prev")?.closest("p");
    if (!medsP) return;
    const p = document.createElement("p");
    p.className = "verso-continua";
    const strong = document.createElement("strong");
    strong.textContent = titulo;
    p.appendChild(strong);
    p.appendChild(document.createTextNode(" "));
    itens.forEach((txt) => {
      const s = document.createElement("span");
      s.className = "chip-li";
      s.textContent = txt;
      p.appendChild(s);
    });
    medsP.parentNode.insertBefore(p, medsP.nextSibling);
  }

  function setOverflowWall(count) {
    const verso = document.querySelector(".carteirinha-visual .verso");
    if (!verso) return;
    let badge = verso.querySelector(".overflow-wall");
    if (count > 0) {
      if (!badge) {
        badge = document.createElement("div");
        badge.className = "overflow-wall";
        verso.appendChild(badge);
      }
      badge.textContent = `Limite excedido, recomenda-se simplificar (+${count})`;
    } else if (badge) {
      badge.remove();
    }
  }

  function renderListPlainTo(containerId, items) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = "";
    const list = (items || []).map((s) => (s ?? "").trim()).filter(Boolean);
    if (!list.length) {
      el.textContent = PREVIEW_DEFAULT;
      return;
    }
    const frag = document.createDocumentFragment();
    list.forEach((txt) => {
      const s = document.createElement("span");
      s.className = "chip-li";
      s.textContent = txt;
      frag.appendChild(s);
    });
    el.appendChild(frag);
  }

  function flowMedicalOverflow() {
    const frente = document.querySelector(".carteirinha-visual .frente");
    const verso = document.querySelector(".carteirinha-visual .verso");
    if (!frente || !verso) return;

    // --- FRENTE: elementos e rótulos ---
    const alergiasSpan = document.getElementById("alergias-prev");
    const condicoesSpan = document.getElementById("condicoes-prev");
    const medsFrontP = ensureFrontMedicamentos(); // cria <p id="meds-front-p"><strong>Medicamentos...</strong> <span id="medicamentos-front">
    const medsFrontSpan = document.getElementById("medicamentos-front");

    const alergiasP = alergiasSpan ? alergiasSpan.closest("p") : null;
    const condicoesP = condicoesSpan ? condicoesSpan.closest("p") : null;

    // --- VERSO
    const medsLabelP =
      Array.from(verso.querySelectorAll("p")).find((p) => {
        const st = p.querySelector("strong");
        return st && /Medicamentos de uso contínuo/i.test(st.textContent || "");
      }) || null;
    const medsListP = document.getElementById("medicamentos-prev") || null;

    const contatosP =
      Array.from(verso.querySelectorAll("p")).find((p) => {
        const st = p.querySelector("strong");
        return st && /Contatos de Emergência/i.test(st.textContent || "");
      }) || null;

    // --- FONTE: lê dos chips ---
    const alergiasAll = readItemsFromChips("alergias-chips");
    const condicoesAll = readItemsFromChips("condicoes-chips");
    const medsAll = readItemsFromChips("medicamentos-chips");

    const PREV_DEF =
      typeof PREVIEW_DEFAULT !== "undefined"
        ? PREVIEW_DEFAULT
        : "Não informado";

    // Helpers básicos
    const makeChip = (txt) => {
      const s = document.createElement("span");
      s.className = "chip-li";
      s.textContent = txt;
      return s;
    };
    const clear = (el) => {
      if (el) el.innerHTML = "";
    };

    // --- Reset de conteúdo (sem esconder rótulos ainda) ---
    clear(alergiasSpan);
    clear(condicoesSpan);
    clear(medsFrontSpan);
    if (alergiasAll.length === 0 && alergiasSpan)
      alergiasSpan.textContent = PREV_DEF;
    if (condicoesAll.length === 0 && condicoesSpan)
      condicoesSpan.textContent = PREV_DEF;
    if (medsAll.length === 0 && medsFrontSpan)
      medsFrontSpan.textContent = PREV_DEF;
    if (medsFrontP) medsFrontP.style.display = ""; // rótulo da frente visível por padrão

    // Limpa verso (e esconde Medicamentos do verso por padrão)
    if (medsListP) {
      medsListP.innerHTML = "";
      medsListP.style.display = "none";
    }
    if (medsLabelP) medsLabelP.style.display = "none";
    verso.querySelectorAll(".verso-flow").forEach((n) => n.remove());

    // Limites visuais
    const frontBottom = () => {
      const ANTECIPAR = 10; // pixels para antecipar o salto pro verso
      const rf = frente.getBoundingClientRect();
      return rf.top + rf.height - ANTECIPAR;
    };
    const avisoEl = verso.querySelector(".aviso");
    const floorSentinel = ensureBackFloor();
    const wallTop = () => {
      const paddingSeguranca = 80; // px de respiro entre conteúdo e aviso
      const rv = verso.getBoundingClientRect();
      return rv.top + rv.height - paddingSeguranca;
    };

    const overflowFront = (el) =>
      el.getBoundingClientRect().bottom > frontBottom();
    const overflowBack = (el) =>
      el.getBoundingClientRect().bottom > wallTop() - 0.5;

    // Estado
    let frontFull = false;
    const frontCount = { alergias: 0, condicoes: 0, medicamentos: 0 };
    const backHas = { alergias: false, condicoes: false, medicamentos: false };
    let extraHidden = 0;

    // Cria (uma vez) e reutiliza o bloco do verso para Alergias/Condições
    function getBackHost(sectionKey, labelText) {
      // Pegue âncora fixa de inserção no verso:
      // - se existir o bloco rotulado de Medicamentos (medsLabelP ou medsListP), insere ANTES dele
      // - senão, insere ANTES dos Contatos
      // - fallback: no fim do verso
      const anchor =
        typeof medsLabelP !== "undefined" && medsLabelP
          ? medsLabelP
          : typeof medsListP !== "undefined" && medsListP
            ? medsListP
            : typeof contatosP !== "undefined" && contatosP
              ? contatosP
              : null;

      // Medicamentos usa o bloco rotulado existente
      if (sectionKey === "medicamentos") {
        if (medsLabelP) medsLabelP.style.display = "";
        if (medsListP) medsListP.style.display = "";
        return medsListP;
      }

      // Para Alergias/Condições criamos um bloco único (ou reutilizamos) por seção
      const id = `back-${sectionKey}-host`;
      let hostSpan = verso.querySelector(`#${id} .chips-host`);

      if (!hostSpan) {
        const p = document.createElement("p");
        p.id = id;
        p.className = "verso-flow";

        const strong = document.createElement("strong");
        strong.textContent = labelText + ":";
        p.appendChild(strong);
        p.appendChild(document.createTextNode(" "));

        hostSpan = document.createElement("span");
        hostSpan.className = "chips-host";
        p.appendChild(hostSpan);

        // Insere antes da âncora definida acima
        if (anchor && anchor.parentNode) {
          anchor.parentNode.insertBefore(p, anchor);
        } else {
          verso.appendChild(p);
        }
      }

      return hostSpan;
    }

    function tryAddFront(sectionKey, spanEl, txt) {
      if (frontFull || !spanEl) return false;
      const chip = makeChip(txt);
      spanEl.appendChild(chip);
      if (overflowFront(chip)) {
        spanEl.removeChild(chip);
        frontFull = true;
        return false;
      }
      frontCount[sectionKey]++;
      return true;
    }

    function tryAddBack(sectionKey, labelText, txt) {
      const host = getBackHost(sectionKey, labelText);
      if (!host) return false;
      const chip = makeChip(txt);
      host.appendChild(chip);
      if (overflowBack(chip)) {
        host.removeChild(chip);
        extraHidden++;
        return false;
      }
      backHas[sectionKey] = true;
      return true;
    }

    // Ordem de empacotamento
    const order = [
      {
        k: "alergias",
        label: "Alergias",
        items: alergiasAll,
        span: alergiasSpan,
        pFront: alergiasP,
      },
      {
        k: "condicoes",
        label: "Condições Médicas",
        items: condicoesAll,
        span: condicoesSpan,
        pFront: condicoesP,
      },
      {
        k: "medicamentos",
        label: "Medicamentos de uso contínuo",
        items: medsAll,
        span: medsFrontSpan,
        pFront: medsFrontP,
      },
    ];

    // Distribui item a item; quando a frente enche, tudo o que vier vai para o verso
    requestAnimationFrame(() => {
      outer: for (const sec of order) {
        const { k, label, items, span } = sec;
        if (!items || !items.length) continue;

        for (let i = 0; i < items.length; i++) {
          const txt = items[i];

          if (!frontFull && tryAddFront(k, span, txt)) continue;

          // Frente cheia (ou não coube este item): manda para o verso
          if (!tryAddBack(k, label, txt)) {
            // bateu na parede: conta o restante desta seção e das próximas
            extraHidden += items.length - i - 1;
            const idx = order.findIndex((s) => s.k === k);
            for (let j = idx + 1; j < order.length; j++) {
              extraHidden += order[j].items?.length || 0;
            }
            break outer;
          }
        }
      }

      // Parede + rótulos finais
      setOverflowWall(extraHidden);

      // Esconde rótulos da frente das seções que começaram no verso
      if (alergiasP)
        alergiasP.style.display =
          alergiasAll.length && frontCount.alergias === 0 && backHas.alergias
            ? "none"
            : "";
      if (condicoesP)
        condicoesP.style.display =
          condicoesAll.length && frontCount.condicoes === 0 && backHas.condicoes
            ? "none"
            : "";
      if (medsFrontP)
        medsFrontP.style.display =
          medsAll.length &&
          frontCount.medicamentos === 0 &&
          backHas.medicamentos
            ? "none"
            : "";

      // Se não há medicamentos, mantém "Não informado" na frente e verso oculto
      if (medsAll.length === 0) {
        if (medsLabelP) medsLabelP.style.display = "none";
        if (medsListP) medsListP.style.display = "none";
      }
    });
  }

  // Piso fixo do verso: uma sentinela 1px acima do aviso legal
  function ensureBackFloor() {
    const verso = document.querySelector(".carteirinha-visual .verso");
    if (!verso) return null;
    let floor = verso.querySelector(".floor-sentinel");
    if (!floor) {
      floor = document.createElement("div");
      floor.className = "floor-sentinel";
      verso.appendChild(floor);
    }
    return floor;
  }

  function scheduleFlowRecalc() {
    if (_flowTimer) cancelAnimationFrame(_flowTimer);
    _flowTimer = requestAnimationFrame(() => {
      try {
        flowMedicalOverflow();
      } catch (e) {
        console.error("[TáSafe] flowMedicalOverflow falhou:", e);
      }
    });
  }

  // ==========================================
  // Inicialização final
  // ==========================================
  renderContatos();
  showContatoDefaultHint();
  atualizarPreview();
  const fotoPrev = document.getElementById("foto-preview");
  if (fotoPrev && !fotoPrev.style.backgroundImage)
    fotoPrev.textContent = "FOTO";
});
