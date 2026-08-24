"use client";

import React, { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import confetti from 'canvas-confetti';
import { insertFeedback } from '@/lib/supabase/feedback';
import { trackEvent } from '@/lib/analytics';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

interface FeedbackFabProps {
  sessionId: string;
}

export interface FeedbackFabRef {
  open: () => void;
}

function safeGetSessionStorage(key: string) {
  try {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

const FeedbackFab = forwardRef<FeedbackFabRef, FeedbackFabProps>(({ sessionId }, ref) => {
  const reduce = useReducedMotion();

  // UI state
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const modalRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const MAX_LENGTH = 500;
  const isOverLimit = message.length > MAX_LENGTH;
  const isEmpty = message.trim().length === 0;

  // Derived username (Letterboxd) – single source, automatic
  const lbUsername = safeGetSessionStorage('lb_username') || '';

  // Imperative handle for programmatic opening
  useImperativeHandle(ref, () => ({
    open: () => setIsOpen(true)
  }));

  const handleClose = useCallback(() => {
    if (isSubmitting) return;
    setIsOpen(false);
    setMessage('');
    setContact('');
    setIsSubmitting(false);
    setShowSuccess(false);
  }, [isSubmitting]);

  useBodyScrollLock(isOpen);

  useEffect(() => {
    if (!isOpen) return;
    textareaRef.current?.focus();
  }, [isOpen]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && handleClose();
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('keydown', onEsc);
    };
  }, [isOpen, handleClose]);

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleOpen = () => {
    setIsOpen(true);
    trackEvent('feedback_opened');
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) handleClose();
  };

  const handleSubmit = useCallback(async () => {
    if (isEmpty || isOverLimit || isSubmitting) return;
    setIsSubmitting(true);

    try {
      const ua = typeof navigator !== "undefined" ? navigator.userAgent: "";
      
      const os =
        /windows/i.test(ua) ? "Windows" :
        /mac os x|macintosh/i.test(ua) ? "macOS" : 
        /iphone|ios|ipad/i.test(ua) ? "iOS" :
        /android/i.test(ua) ? "Android" :
        /linux/i.test(ua) ? "Linux" : "Unknown";
        
      const device_type =
      /iphone|ipod|android.*mobile/i.test(ua) ? "mobile" :
      /ipad|tablet|android(?!.*mobile)/i.test(ua) ? "tablet" : "desktop";

      if (!lbUsername) {
        alert("We couldn't detect your letterboxd username. Please re-run the analysis first.");
        setIsSubmitting(false);
        trackEvent('feedback_submit_blocked', { reason: 'missing_username' });
        return;
      }

      const payload = {
        session_id: sessionId,
        username: lbUsername,
        contact: contact.trim() || null,
        message: message.trim() || null,
        os,
        device_type: device_type as 'mobile' | 'desktop' | 'tablet' | 'unknown',
      };

      await insertFeedback(payload);
      trackEvent('feedback_submitted', {
        has_contact: !!payload.contact,
        has_message: !!payload.message,
        os,
        device_type,
      });

      setShowSuccess(true);

      if (!reduce) {
        try {
          confetti({ particleCount: 30, spread: 70, origin: { y: 0.6 } });
        } catch {}
      }

      setTimeout(() => handleClose(), 1000);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      alert(`Feedback submission failed: ${errorMessage}`);
      trackEvent('feedback_submit_failed', { error: errorMessage });
    } finally {
      setIsSubmitting(false);
    }
  }, [isEmpty, isOverLimit, isSubmitting, message, contact, reduce, lbUsername, sessionId, handleClose]);

  return (
    <>
      {/* FAB */}
      <motion.button
        onClick={handleOpen}
        className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-40 w-12 h-12 sm:w-14 sm:h-14 bg-orange-500 hover:bg-orange-600 rounded-full shadow-lg hover:shadow-xl transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-orange-400/60 focus:ring-offset-2 focus:ring-offset-slate-900"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        aria-label="Send feedback"
      >
        <svg className="w-6 h-6 text-white mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      </motion.button>

      {/* Modal */}
      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-[var(--mw-modal-z,200)] flex items-center justify-center p-4">
            <motion.div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={handleBackdropClick}
              aria-hidden="true"
            />
            <motion.div
              ref={modalRef}
              className="relative w-full max-w-md mx-auto bg-slate-900 rounded-2xl shadow-xl border border-slate-700/60 overflow-hidden"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
            >
              {/* Header */}
              <div className="px-6 py-4 border-b border-slate-700/60">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-white">Got a minute for feedback?</h2>
                  <button
                    onClick={handleClose}
                    className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
                    aria-label="Close feedback"
                  >
                    <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Content */}
              <div className="px-6 py-4 space-y-4">
                {/* Message */}
                <div>
                  <label htmlFor="feedback-message" className="block text-sm font-medium text-slate-300 mb-2">
                    Message
                  </label>
                  <div className="relative">
                    <textarea
                      ref={textareaRef}
                      id="feedback-message"
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      onKeyDown={handleTextareaKeyDown}
                      placeholder="Tell us what you think..."
                      className="w-full min-h-[120px] px-4 py-3 bg-slate-800 border border-slate-600 rounded-xl text-white placeholder-slate-400 resize-none focus:outline-none focus:ring-2 focus:ring-orange-400/60 focus:border-transparent text-sm"
                      maxLength={MAX_LENGTH}
                    />
                    <div className="absolute bottom-2 right-2 text-xs text-slate-500">
                      {message.length}/{MAX_LENGTH}
                    </div>
                  </div>
                </div>

                {/* Contact */}
                <div>
                  <label htmlFor="contact" className="block text-sm font-medium text-slate-300 mb-2">
                    Optional contact (email etc.)
                  </label>
                  <input
                    id="contact"
                    type="text"
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                    placeholder="Email etc."
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-400/60 focus:border-transparent text-sm"
                  />
                </div>


              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-slate-700/60 bg-slate-800/50">
                <div className="flex gap-3">
                  <button 
                    onClick={handleClose}
                    disabled={isSubmitting}
                    className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50 text-sm"
                  >
                    Skip
                  </button>
                  <button 
                    onClick={handleSubmit} 
                    disabled={isEmpty || isOverLimit || isSubmitting}
                    className="flex-1 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm"
                  >
                    {isSubmitting ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Sending...
                      </>
                    ) : (
                      'Send Feedback'
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Success Toast */}
      <AnimatePresence>
        {showSuccess && (
          <motion.div
            className="fixed top-4 right-4 z-50 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg"
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 100 }}
          >
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-sm">Feedback sent! Thank you.</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
});

FeedbackFab.displayName = 'FeedbackFab';

export default FeedbackFab;
