'use client';

import { motion } from 'framer-motion';

import type { Slide } from '../types';
import { MOTION_DURATION, MOTION_EASE } from '../motion/motionTokens';
import { useStoryMotion } from '../motion/StoryMotionContext';
import { DirectorCinematicVisual } from '../director/DirectorCinematicVisual';
import { ActorCinematicVisual } from '../actor/ActorCinematicVisual';
import { ReviewCinematicVisual } from '../review/ReviewCinematicVisual';
import { FinaleCurtainVisual } from '../finale/FinaleCurtainVisual';
import {
  HeroPoster,
  PosterCascade,
  PosterMosaic,
  PosterStrip,
  PosterWall,
  PortraitStack,
  RecapVisual,
} from './PosterLayouts';
import { PosterField } from './PosterField';
import { resolvePosterFieldLayout } from './posterFieldConfig';
import { PersonCinematicVisual } from './cinematic/PersonCinematicVisual';

export function StoryVisual({ slide }: { slide: Slide }) {
  const { reduce } = useStoryMotion();
  const media = slide.media ?? [];
  const accent = slide.accent ?? '#f59e0b';
  const hero = media[0];
  const posterLayout = resolvePosterFieldLayout(slide.visual, slide.posterLayout);

  return (
    <motion.div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{
        duration: reduce ? 0 : MOTION_DURATION.transition,
        ease: MOTION_EASE.editorial,
      }}
    >
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(circle at 18% 18%, ${accent}42, transparent 30%), radial-gradient(circle at 80% 12%, rgba(103,232,249,0.20), transparent 26%), linear-gradient(145deg,#090806 0%,#17120f 48%,#050505 100%)`,
        }}
      />

      {hero && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={hero.url}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full scale-110 object-cover opacity-25 blur-xl"
        />
      )}

      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.78),rgba(0,0,0,0.18)_52%,rgba(0,0,0,0.76))]" />
      <div className="absolute inset-0 opacity-[0.16] [background-image:linear-gradient(rgba(245,215,168,.16)_1px,transparent_1px),linear-gradient(90deg,rgba(245,215,168,.12)_1px,transparent_1px)] [background-size:42px_42px]" />

      {media.length > 0 && (
        <PosterField slideKey={slide.key} layout={posterLayout}>
          {slide.visual === 'director' && slide.directorSequence ? (
            <DirectorCinematicVisual sequence={slide.directorSequence} accent={accent} />
          ) : slide.visual === 'actor' && slide.actorSequence ? (
            <ActorCinematicVisual sequence={slide.actorSequence} accent={accent} />
          ) : slide.visual === 'review' && slide.reviewSequence ? (
            <ReviewCinematicVisual sequence={slide.reviewSequence} accent={accent} />
          ) : slide.visual === 'finale' && slide.finaleSequence ? (
            <FinaleCurtainVisual sequence={slide.finaleSequence} accent={accent} />
          ) : slide.visual === 'director' || slide.visual === 'person' ? (
            <PersonCinematicVisual media={media} accent={accent} sequenceKey={slide.key} />
          ) : slide.visual === 'poster-wall' ? (
            <PosterWall media={media} accent={accent} />
          ) : slide.visual === 'portrait' ? (
            <PortraitStack media={media} accent={accent} />
          ) : slide.visual === 'cascade' ? (
            <PosterCascade media={media} accent={accent} />
          ) : slide.visual === 'strip' ? (
            <PosterStrip media={media} accent={accent} />
          ) : slide.visual === 'hero' ? (
            <HeroPoster media={media} accent={accent} />
          ) : slide.visual === 'recap' ? (
            <RecapVisual media={media} accent={accent} />
          ) : (
            <PosterMosaic media={media} accent={accent} />
          )}
        </PosterField>
      )}

      <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black via-black/50 to-transparent" />
    </motion.div>
  );
}
