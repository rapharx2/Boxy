globalThis.browser ??= globalThis.chrome;
// Content script - detects content from the current page

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'detectContent') {
    detectPageContent().then(sendResponse).catch(() => {
      // Fallback if detection fails
      sendResponse({
        type: 'article',
        preview: null,
        snippet: document.title || ''
      });
    });
    return true; // Keep channel open for async response
  }

  if (message.action === 'extractArticle') {
    // Extração síncrona do texto completo do artigo para o arquivo permanente
    try {
      sendResponse(extractArticleContent());
    } catch (error) {
      sendResponse(null);
    }
    return false;
  }
});

async function detectPageContent() {
  let type = 'article';
  let preview = null;
  let snippet = '';

  try {
    // 1. Check for video
    const video = document.querySelector('video');
    if (video && video.src) {
      type = 'video';
      preview = video.poster || await captureVideoFrame(video);
      snippet = document.title;
      return { type, preview, snippet };
    }

    // 2. Check for selected text
    const selection = window.getSelection().toString().trim();
    if (selection && selection.length > 10) {
      type = 'text';
      snippet = selection.substring(0, 500);
      preview = null;
      return { type, preview, snippet };
    }

    // 3. Check for large image
    const images = Array.from(document.querySelectorAll('img'));
    const largeImages = images.filter(img => 
      img.naturalWidth > 200 && 
      img.naturalHeight > 200 && 
      img.complete &&
      !img.src.includes('data:image')
    );
    
    if (largeImages.length > 0) {
      // Find largest image
      const largestImage = largeImages.reduce((largest, img) => {
        const area = img.naturalWidth * img.naturalHeight;
        const largestArea = largest.naturalWidth * largest.naturalHeight;
        return area > largestArea ? img : largest;
      });

      type = 'image';
      preview = await createImageThumbnail(largestImage.src);
      snippet = largestImage.alt || document.title;
      return { type, preview, snippet };
    }

    // 4. Default to article
    type = 'article';
    snippet = extractArticleSnippet();
    preview = null; // Will be captured by popup.js using captureVisibleTab

  } catch (error) {
    console.error('Content detection error:', error);
    // Return safe defaults
    type = 'article';
    snippet = document.title || '';
    preview = null;
  }

  return { type, preview, snippet };
}

// Capture video frame
function captureVideoFrame(video) {
  return new Promise((resolve) => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 240;
      canvas.height = 135;
      const ctx = canvas.getContext('2d');
      
      // Wait for video to be ready
      if (video.readyState >= 2) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.5));
      } else {
        video.addEventListener('loadeddata', () => {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.5));
        }, { once: true });
        
        // Timeout fallback
        setTimeout(() => resolve(null), 2000);
      }
    } catch (error) {
      resolve(null);
    }
  });
}

// Create image thumbnail
function createImageThumbnail(imageSrc) {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const maxWidth = 240;
          const maxHeight = 160;
          
          let width = img.width;
          let height = img.height;
          
          if (width > height) {
            if (width > maxWidth) {
              height *= maxWidth / width;
              width = maxWidth;
            }
          } else {
            if (height > maxHeight) {
              width *= maxHeight / height;
              height = maxHeight;
            }
          }
          
          canvas.width = width;
          canvas.height = height;
          
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          
          resolve(canvas.toDataURL('image/jpeg', 0.6));
        } catch (error) {
          // CORS error - return original URL
          resolve(imageSrc);
        }
      };
      
      img.onerror = () => resolve(imageSrc);
      
      // Timeout fallback
      setTimeout(() => resolve(imageSrc), 3000);
      
      img.src = imageSrc;
      
    } catch (error) {
      resolve(imageSrc);
    }
  });
}

// ===== Botão flutuante "Save highlight" ao selecionar texto =====

const BOXY_HIGHLIGHT_BTN_ID = 'boxy-save-highlight-btn';

function removeHighlightButton() {
  const existing = document.getElementById(BOXY_HIGHLIGHT_BTN_ID);
  if (existing) existing.remove();
}

function showHighlightButton(selectionText, rect) {
  // Evita injetar duas vezes
  removeHighlightButton();

  const btn = document.createElement('button');
  btn.id = BOXY_HIGHLIGHT_BTN_ID;
  btn.type = 'button';
  btn.textContent = '📦 Save highlight';

  // Estilos inline apenas — o botão vive em páginas arbitrárias
  btn.style.cssText = [
    'position: absolute',
    'z-index: 2147483647',
    `top: ${Math.max(0, rect.top + window.scrollY - 38)}px`,
    `left: ${Math.max(0, rect.left + window.scrollX)}px`,
    'padding: 6px 12px',
    'border: none',
    'border-radius: 8px',
    'background: #1a1a2e',
    'color: #ffffff',
    'font-family: system-ui, -apple-system, sans-serif',
    'font-size: 13px',
    'line-height: 1.2',
    'cursor: pointer',
    'box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3)',
    'margin: 0'
  ].join(' !important; ') + ' !important;';

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    chrome.runtime.sendMessage({
      action: 'saveHighlight',
      text: selectionText,
      url: location.href,
      title: document.title
    });
    removeHighlightButton();
  });

  // mousedown no botão não pode limpar a seleção nem disparar o handler do documento
  btn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  document.body.appendChild(btn);
}

document.addEventListener('mouseup', (e) => {
  // Ignora mouseup no próprio botão
  if (e.target && e.target.id === BOXY_HIGHLIGHT_BTN_ID) return;

  // Pequeno atraso para a seleção estar estável após o mouseup
  setTimeout(() => {
    const selection = window.getSelection();
    const text = selection ? selection.toString().trim() : '';

    if (text.length > 10 && selection.rangeCount > 0) {
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      showHighlightButton(text, rect);
    } else {
      removeHighlightButton();
    }
  }, 0);
});

document.addEventListener('mousedown', (e) => {
  // Remove o botão em cliques fora dele
  if (!e.target || e.target.id !== BOXY_HIGHLIGHT_BTN_ID) {
    removeHighlightButton();
  }
});

document.addEventListener('scroll', () => {
  removeHighlightButton();
}, true);

document.addEventListener('selectionchange', () => {
  // Remove o botão quando a seleção é limpa
  const text = window.getSelection().toString().trim();
  if (!text) removeHighlightButton();
});

// Extract article snippet
function extractArticleSnippet() {
  // Try to find main content
  const selectors = [
    'article',
    '[role="main"]',
    'main',
    '.post-content',
    '.article-content',
    '.entry-content',
    '.content',
    '#content'
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      const text = element.innerText.trim();
      if (text.length > 50) {
        return text.substring(0, 500);
      }
    }
  }

  // Fallback to all paragraphs
  const paragraphs = Array.from(document.querySelectorAll('p'));
  const text = paragraphs
    .map(p => p.innerText.trim())
    .filter(t => t.length > 20)
    .slice(0, 3)
    .join(' ');

  return text.substring(0, 500) || document.title || 'Article saved from this page';
}

// Extrai o texto completo do artigo (sem limite de 500) para o arquivo permanente
function extractArticleContent() {
  const MAX_CHARS = 200000; // Limite de sanidade para páginas patológicas
  const NOISE_SELECTOR = 'script, style, nav, footer, aside, header, form, noscript, iframe';

  const selectors = [
    'article',
    '[role="main"]',
    'main',
    '.post-content',
    '.article-content',
    '.entry-content',
    '.content',
    '#content'
  ];

  let text = '';

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (!element) continue;

    // Clona o container para remover o ruído sem tocar na página real
    const clone = element.cloneNode(true);
    clone.querySelectorAll(NOISE_SELECTOR).forEach(node => node.remove());

    // innerText precisa de layout: anexa o clone escondido temporariamente
    clone.style.cssText = 'position: absolute !important; left: -99999px !important; width: 800px !important;';
    document.body.appendChild(clone);
    const candidate = clone.innerText || '';
    clone.remove();

    if (candidate.trim().length > 50) {
      text = candidate;
      break;
    }
  }

  // Fallback: concatena os parágrafos da página
  if (!text.trim()) {
    text = Array.from(document.querySelectorAll('p'))
      .map(p => p.innerText.trim())
      .filter(t => t.length > 20)
      .join('\n\n');
  }

  // Normaliza espaços e colapsa linhas em branco excessivas
  text = text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .substring(0, MAX_CHARS);

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return { text, wordCount };
}
