import React, { useState, useEffect } from 'react';
import './LoadingScreen.css';

const LoadingScreen = ({ loading, message = "Loading Dashboard", onComplete }) => {
    const [progress, setProgress] = useState(0);
    const [isVisible, setIsVisible] = useState(loading);

    useEffect(() => {
        let interval;
        if (loading) {
            setIsVisible(true);
            setProgress(0);

            const runInterval = () => {
                setProgress(prev => {
                    if (prev < 95) {
                        // Stage 1: Fast random increments (2-6%)
                        const increment = Math.floor(Math.random() * 5) + 2;
                        const next = Math.min(prev + increment, 95);

                        // Maintain fast pace (150ms)
                        clearInterval(interval);
                        interval = setInterval(runInterval, 150);
                        return next;
                    } else if (prev < 99) {
                        // Stage 2: Slow increments (1% every 2 seconds)
                        clearInterval(interval);
                        interval = setInterval(runInterval, 2000);
                        return prev + 1;
                    } else {
                        // Stage 3: Lock at 99%
                        clearInterval(interval);
                        return 99;
                    }
                });
            };

            // Start initial interval
            interval = setInterval(runInterval, 150);
        } else {
            // Completion Phase
            setProgress(100);
            const timeout = setTimeout(() => {
                setIsVisible(false);
                if (onComplete) onComplete();
            }, 600);
            return () => {
                clearTimeout(timeout);
                if (interval) clearInterval(interval);
            };
        }
        return () => {
            if (interval) clearInterval(interval);
        };
    }, [loading, onComplete]);

    if (!isVisible) return null;

    return (
        <div className={`loading-screen-overlay ${!loading ? 'fade-out' : ''}`}>
            <div className="loading-content">
                <p>{message}</p>
                <div className="loading-bar-container">
                    <div
                        className="loading-bar-fill"
                        style={{ width: `${progress}%` }}
                    ></div>
                </div>
                <span className="loading-percentage">{progress}%</span>
            </div>
        </div>
    );
};

export default LoadingScreen;
