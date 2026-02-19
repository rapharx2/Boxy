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
