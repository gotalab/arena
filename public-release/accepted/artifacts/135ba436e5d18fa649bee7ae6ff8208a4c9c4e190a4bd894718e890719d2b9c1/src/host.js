/**
 * Shoal Tide-Pool Companion: "Pip" the Otter/Anemone Critter
 * Procedurally drawn 2D host with dynamic emotions and reactions.
 */
(function(root) {
  function createHost(canvas) {
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    // Moods: 'idle', 'curious', 'delighted', 'nervous', 'stung', 'proud'
    let mood = 'idle';
    let moodTimer = 0;
    let blinkTimer = 100;
    let breathPhase = 0;
    let wobble = 0;

    function setMood(newMood, duration = 0) {
      mood = newMood;
      moodTimer = duration; // in frames (approx 60fps)
    }

    function update() {
      breathPhase += 0.05;
      if (blinkTimer > 0) blinkTimer--;
      else if (Math.random() < 0.03) blinkTimer = 120 + Math.floor(Math.random() * 80);

      if (moodTimer > 0) {
        moodTimer--;
        if (moodTimer === 0) mood = 'idle';
      }

      wobble = Math.sin(breathPhase) * 2;
    }

    function draw() {
      ctx.clearRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height / 2 + 2 + (mood === 'delighted' ? -Math.abs(Math.sin(breathPhase * 2) * 5) : wobble);

      ctx.save();
      ctx.translate(cx, cy);

      // Shadow / water ripple underneath
      ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.beginPath();
      ctx.ellipse(0, 24, 22 + Math.sin(breathPhase) * 2, 8, 0, 0, Math.PI * 2);
      ctx.fill();

      // Outer Glow based on mood
      if (mood === 'proud' || mood === 'delighted') {
        const glow = ctx.createRadialGradient(0, 0, 10, 0, 0, 35);
        glow.addColorStop(0, 'rgba(56, 239, 125, 0.4)');
        glow.addColorStop(1, 'rgba(56, 239, 125, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(0, 0, 35, 0, Math.PI * 2);
        ctx.fill();
      } else if (mood === 'stung') {
        const glow = ctx.createRadialGradient(0, 0, 10, 0, 0, 35);
        glow.addColorStop(0, 'rgba(255, 107, 107, 0.4)');
        glow.addColorStop(1, 'rgba(255, 107, 107, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(0, 0, 35, 0, Math.PI * 2);
        ctx.fill();
      }

      // Ears / Anemone tufts
      ctx.fillStyle = '#1e4b6e';
      ctx.beginPath();
      ctx.arc(-16, -14, 7, 0, Math.PI * 2);
      ctx.arc(16, -14, 7, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#4cc9f0';
      ctx.beginPath();
      ctx.arc(-16, -14, 4, 0, Math.PI * 2);
      ctx.arc(16, -14, 4, 0, Math.PI * 2);
      ctx.fill();

      // Body (round squishy sea otter / seal critter)
      const bodyGrad = ctx.createRadialGradient(-4, -6, 4, 0, 0, 24);
      if (mood === 'stung') {
        bodyGrad.addColorStop(0, '#59323c');
        bodyGrad.addColorStop(1, '#2c151c');
      } else if (mood === 'proud') {
        bodyGrad.addColorStop(0, '#358c82');
        bodyGrad.addColorStop(1, '#13403a');
      } else {
        bodyGrad.addColorStop(0, '#2e6b99');
        bodyGrad.addColorStop(1, '#113554');
      }
      ctx.fillStyle = bodyGrad;
      ctx.beginPath();
      ctx.ellipse(0, 0, 22, 20 + (mood === 'nervous' ? -2 : 0), 0, 0, Math.PI * 2);
      ctx.fill();

      // Belly patch
      ctx.fillStyle = mood === 'stung' ? '#44222a' : '#4fa3d1';
      ctx.beginPath();
      ctx.ellipse(0, 6, 13, 10, 0, 0, Math.PI * 2);
      ctx.fill();

      // Cheeks
      ctx.fillStyle = mood === 'stung' ? 'rgba(150, 50, 50, 0.4)' : 'rgba(255, 159, 28, 0.4)';
      ctx.beginPath();
      ctx.arc(-12, 2, 4, 0, Math.PI * 2);
      ctx.arc(12, 2, 4, 0, Math.PI * 2);
      ctx.fill();

      // Eyes
      const isBlinking = blinkTimer < 6 && mood !== 'stung' && mood !== 'nervous';

      if (mood === 'stung') {
        // Spiral / X eyes
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5;
        // Left X
        ctx.beginPath();
        ctx.moveTo(-11, -5); ctx.lineTo(-5, 1);
        ctx.moveTo(-5, -5); ctx.lineTo(-11, 1);
        // Right X
        ctx.moveTo(5, -5); ctx.lineTo(11, 1);
        ctx.moveTo(11, -5); ctx.lineTo(5, 1);
        ctx.stroke();
      } else if (isBlinking) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-11, -2); ctx.lineTo(-5, -2);
        ctx.moveTo(5, -2); ctx.lineTo(11, -2);
        ctx.stroke();
      } else if (mood === 'nervous') {
        // Wide shaking eyes
        const eyeWobble = Math.sin(breathPhase * 8) * 1.5;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(-8 + eyeWobble, -2, 5, 0, Math.PI * 2);
        ctx.arc(8 + eyeWobble, -2, 5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#071524';
        ctx.beginPath();
        ctx.arc(-8 + eyeWobble, -2, 2.5, 0, Math.PI * 2);
        ctx.arc(8 + eyeWobble, -2, 2.5, 0, Math.PI * 2);
        ctx.fill();

        // Sweat droplet
        ctx.fillStyle = '#4cc9f0';
        ctx.beginPath();
        ctx.arc(16, -10, 3, 0, Math.PI * 2);
        ctx.fill();
      } else if (mood === 'delighted' || mood === 'proud') {
        // Happy crescent curved eyes
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(-8, -1, 4, Math.PI, 0, false);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(8, -1, 4, Math.PI, 0, false);
        ctx.stroke();

        if (mood === 'proud') {
          // Small golden coral crown
          ctx.fillStyle = '#ffd166';
          ctx.beginPath();
          ctx.moveTo(-10, -20);
          ctx.lineTo(-6, -26);
          ctx.lineTo(-2, -22);
          ctx.lineTo(2, -26);
          ctx.lineTo(6, -22);
          ctx.lineTo(10, -20);
          ctx.closePath();
          ctx.fill();
        }
      } else {
        // Normal curious round eyes
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(-8, -2, 4.5, 0, Math.PI * 2);
        ctx.arc(8, -2, 4.5, 0, Math.PI * 2);
        ctx.fill();

        // Pupils looking slightly towards center / reading
        ctx.fillStyle = '#071524';
        ctx.beginPath();
        ctx.arc(-7.5, -1.5, 2.5, 0, Math.PI * 2);
        ctx.arc(8.5, -1.5, 2.5, 0, Math.PI * 2);
        ctx.fill();

        // Catchlight
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(-8.5, -2.5, 1.2, 0, Math.PI * 2);
        ctx.arc(7.5, -2.5, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Snout & Nose
      ctx.fillStyle = '#ffd166';
      ctx.beginPath();
      ctx.arc(0, 2, 2, 0, Math.PI * 2);
      ctx.fill();

      // Mouth
      ctx.strokeStyle = mood === 'stung' ? '#ff8585' : '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (mood === 'stung') {
        // Wavy / sad mouth
        ctx.moveTo(-4, 7);
        ctx.quadraticCurveTo(0, 4, 4, 7);
      } else if (mood === 'delighted' || mood === 'proud') {
        // Open smile
        ctx.arc(0, 3, 4, 0, Math.PI, false);
      } else if (mood === 'nervous') {
        // Small worried 'o'
        ctx.arc(0, 6, 2, 0, Math.PI * 2);
      } else {
        // Gentle curious smile
        ctx.moveTo(-3, 4);
        ctx.quadraticCurveTo(0, 6, 3, 4);
      }
      ctx.stroke();

      ctx.restore();
    }

    return {
      update,
      draw,
      setMood
    };
  }

  root.ShoalHost = {
    createHost
  };
})(typeof window !== 'undefined' ? window : globalThis);
