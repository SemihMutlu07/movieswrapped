import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import IsolatedModal from '@/components/IsolatedModal';
import { __resetBodyScrollLockForTests } from '@/hooks/useBodyScrollLock';

afterEach(() => {
  cleanup();
  __resetBodyScrollLockForTests();
});

describe('IsolatedModal', () => {
  it('portals above the page, locks background scroll, and restores it on close', async () => {
    window.scrollTo = vi.fn();
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 240 });

    function Harness({ open }: { open: boolean }) {
      return (
        <IsolatedModal open={open} onClose={() => {}} label="Film shelf">
          <div data-mw-modal-scroll>Shelf body</div>
        </IsolatedModal>
      );
    }

    const { rerender } = render(<Harness open />);
    expect(await screen.findByRole('dialog', { name: 'Film shelf' })).toBeInTheDocument();
    expect(screen.getByTestId('isolated-modal').parentElement).toBe(document.body);
    expect(document.body).toHaveAttribute('data-mw-scroll-locked', 'true');
    expect(document.documentElement).toHaveAttribute('data-mw-scroll-locked', 'true');
    expect(document.body.style.top).toBe('-240px');
    expect(screen.getByTestId('isolated-modal').querySelector('.mw-isolated-modal__frame')).not.toBeNull();
    expect(screen.getByRole('dialog')).toHaveAttribute('data-mw-modal-scroll');

    rerender(<Harness open={false} />);
    expect(document.body).not.toHaveAttribute('data-mw-scroll-locked');
    expect(document.body.style.top).toBe('');
  });

  it('keeps pointer events on the backdrop so the page behind cannot be clicked', async () => {
    render(
      <IsolatedModal open onClose={() => {}} label="Shelf">
        <p>Inside</p>
      </IsolatedModal>,
    );
    const modal = await screen.findByTestId('isolated-modal');
    const backdrop = modal.querySelector('.mw-isolated-modal__backdrop');
    expect(backdrop).not.toBeNull();
    expect(backdrop).toHaveClass('mw-isolated-modal__backdrop');
  });

  it('inerts page siblings so chrome behind the overlay cannot be used', async () => {
    const chrome = document.createElement('div');
    chrome.textContent = 'page chrome';
    document.body.appendChild(chrome);
    render(
      <IsolatedModal open onClose={() => {}} label="Shelf">
        <div data-mw-modal-scroll>Inside</div>
      </IsolatedModal>,
    );
    await screen.findByTestId('isolated-modal');
    expect(chrome).toHaveAttribute('inert');
    chrome.remove();
  });

  it('does not inert overlay layers such as share popovers', async () => {
    const layer = document.createElement('div');
    layer.setAttribute('data-mw-overlay-layer', 'true');
    document.body.appendChild(layer);
    const chrome = document.createElement('div');
    document.body.appendChild(chrome);
    render(
      <IsolatedModal open onClose={() => {}} label="Shelf">
        <div data-mw-modal-scroll>Inside</div>
      </IsolatedModal>,
    );
    await screen.findByTestId('isolated-modal');
    expect(layer).not.toHaveAttribute('inert');
    expect(chrome).toHaveAttribute('inert');
    layer.remove();
    chrome.remove();
  });
});
