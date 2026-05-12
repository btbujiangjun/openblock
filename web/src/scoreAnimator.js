/**
 * scoreAnimator.js - 得分滚动动画与强化效果
 *
 * 游戏结束时分数从0滚动到最终得分，配合强化视觉效果
 */

const SCORE_ANIMATION_CONFIG = {
    duration: 1500,
    easing: 'easeOutExpo',
    chunkSize: 50,
    reinforceScale: 1.15,
    reinforceDuration: 200
};

let _scoreElement = null;
let _animationId = null;

export function initScoreAnimator() {
    _scoreElement = document.getElementById('over-score');
    return _scoreElement !== null;
}

function _easeOutExpo(t) {
    return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

function _formatNumber(num) {
    return Math.floor(num).toLocaleString();
}

export function animateScore(targetScore, options = {}) {
    if (!_scoreElement) {
        initScoreAnimator();
    }

    if (!_scoreElement) {
        console.warn('[ScoreAnimator] Score element not found');
        return Promise.resolve();
    }

    const config = { ...SCORE_ANIMATION_CONFIG, ...options };
    const startTime = performance.now();
    const startScore = 0;

    if (_animationId) {
        cancelAnimationFrame(_animationId);
    }

    return new Promise((resolve) => {
        function _animate(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / config.duration, 1);
            const easedProgress = _easeOutExpo(progress);

            const currentScore = startScore + (targetScore - startScore) * easedProgress;
            _scoreElement.textContent = _formatNumber(currentScore);

            const scale = 1 + (config.reinforceScale - 1) * Math.sin(progress * Math.PI);
            _scoreElement.style.transform = `scale(${scale})`;

            if (progress < 1) {
                _animationId = requestAnimationFrame(_animate);
            } else {
                _scoreElement.textContent = _formatNumber(targetScore);
                _scoreElement.style.transform = '';
                _triggerFinalReinforce(targetScore);
                _animationId = null;
                resolve();
            }
        }

        _animationId = requestAnimationFrame(_animate);
    });
}

function _triggerFinalReinforce(score) {
    if (!_scoreElement) return;

    _scoreElement.classList.add('score-final-reinforce');

    const particles = _createScoreParticles(score);
    particles.forEach(p => document.body.appendChild(p));

    setTimeout(() => {
        _scoreElement.classList.remove('score-final-reinforce');
        particles.forEach(p => p.remove());
    }, 600);
}

function _createScoreParticles(score) {
    const particles = [];
    const isHighScore = score >= 1000;
    const count = isHighScore ? 12 : 6;

    for (let i = 0; i < count; i++) {
        const particle = document.createElement('div');
        particle.className = 'score-particle';
        particle.textContent = ['✨', '⭐', '💫', '🌟'][i % 4];

        const rect = _scoreElement.getBoundingClientRect();
        const startX = rect.left + rect.width / 2;
        const startY = rect.top + rect.height / 2;

        const angle = (Math.PI * 2 / count) * i + Math.random() * 0.5;
        const distance = 80 + Math.random() * 60;
        const endX = startX + Math.cos(angle) * distance;
        const endY = startY + Math.sin(angle) * distance - 40;

        particle.style.cssText = `
            position: fixed;
            left: ${startX}px;
            top: ${startY}px;
            font-size: 24px;
            pointer-events: none;
            z-index: 9999;
            animation: scoreParticleFly 0.8s ease-out forwards;
            --end-x: ${endX}px;
            --end-y: ${endY}px;
        `;

        particles.push(particle);
    }

    return particles;
}

export function stopScoreAnimation() {
    if (_animationId) {
        cancelAnimationFrame(_animationId);
        _animationId = null;
    }
}

export function setScoreImmediate(score) {
    if (!_scoreElement) {
        initScoreAnimator();
    }
    if (_scoreElement) {
        _scoreElement.textContent = _formatNumber(score);
    }
}

if (!document.getElementById('score-particle-styles')) {
    const style = document.createElement('style');
    style.id = 'score-particle-styles';
    style.textContent = `
        @keyframes scoreParticleFly {
            0% {
                opacity: 1;
                transform: translate(-50%, -50%) scale(0.5);
            }
            50% {
                opacity: 1;
                transform: translate(-50%, -50%) scale(1.2);
            }
            100% {
                opacity: 0;
                transform: translate(calc(-50% + var(--end-x) - var(--start-x, 0px)), calc(-50% + var(--end-y))) scale(0.3);
            }
        }
        .score-final-reinforce {
            animation: scoreReinforce 0.6s ease-out;
        }
        @keyframes scoreReinforce {
            0% { transform: scale(1); filter: brightness(1); }
            30% { transform: scale(1.2); filter: brightness(1.3); }
            60% { transform: scale(1.1); filter: brightness(1.1); }
            100% { transform: scale(1); filter: brightness(1); }
        }
    `;
    document.head.appendChild(style);
}