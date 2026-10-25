// v9.257 (security): पहले index.html में inline <script> था — CSP से 'unsafe-inline' हटाने के लिए अलग फ़ाइल
// पेज दिखने से *पहले* ही theme लगाएं — वरना पहले हल्का (light) फ्लैश दिखकर फिर dark में बदलेगा
try{
  if(localStorage.getItem("dc_theme")==="dark") document.documentElement.setAttribute("data-theme","dark");
  // v9.205: बड़े अक्षर भी पहले ही — वरना छोटे दिखकर फिर बड़े होते (झटका)
  if(localStorage.getItem("dc_bigtext")==="1") document.documentElement.classList.add("big-text");
}catch(e){}
