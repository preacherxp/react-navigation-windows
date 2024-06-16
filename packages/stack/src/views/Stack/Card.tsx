import type { LocaleDirection } from '@react-navigation/native';
import Color from 'color';
import * as React from 'react';
import {
  Animated,
  InteractionManager,
  Platform,
  type StyleProp,
  StyleSheet,
  View,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import type { EdgeInsets } from 'react-native-safe-area-context';

import type {
  GestureDirection,
  Layout,
  StackCardInterpolationProps,
  StackCardStyleInterpolator,
  TransitionSpec,
} from '../../types';
import { CardAnimationContext } from '../../utils/CardAnimationContext';
import { getDistanceForDirection } from '../../utils/getDistanceForDirection';
import { getInvertedMultiplier } from '../../utils/getInvertedMultiplier';
import { memoize } from '../../utils/memoize';
import { CardSheet, type CardSheetRef } from './CardSheet';

type Props = ViewProps & {
  interpolationIndex: number;
  closing: boolean;
  next?: Animated.AnimatedInterpolation<number>;
  current: Animated.AnimatedInterpolation<number>;
  gesture: Animated.Value;
  layout: Layout;
  insets: EdgeInsets;
  direction: LocaleDirection;
  pageOverflowEnabled: boolean;
  gestureDirection: GestureDirection;
  onOpen: () => void;
  onClose: () => void;
  onTransition: (props: { closing: boolean; gesture: boolean }) => void;
  onGestureBegin: () => void;
  onGestureCanceled: () => void;
  onGestureEnd: () => void;
  children: React.ReactNode;
  overlay: (props: {
    style: Animated.WithAnimatedValue<StyleProp<ViewStyle>>;
  }) => React.ReactNode;
  overlayEnabled: boolean;
  shadowEnabled: boolean;
  gestureEnabled: boolean;
  gestureResponseDistance?: number;
  gestureVelocityImpact: number;
  transitionSpec: {
    open: TransitionSpec;
    close: TransitionSpec;
  };
  preloaded: boolean;
  styleInterpolator: StackCardStyleInterpolator;
  containerStyle?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
};

const GESTURE_VELOCITY_IMPACT = 0.3;

const TRUE = 1;
const FALSE = 0;

const useNativeDriver = Platform.OS !== 'web';

const hasOpacityStyle = (style: any) => {
  if (style) {
    const flattenedStyle = StyleSheet.flatten(style);
    return flattenedStyle.opacity != null;
  }

  return false;
};

export class Card extends React.Component<Props> {
  static defaultProps = {
    shadowEnabled: false,
    gestureEnabled: true,
    gestureVelocityImpact: GESTURE_VELOCITY_IMPACT,
    overlay: ({
      style,
    }: {
      style: Animated.WithAnimatedValue<StyleProp<ViewStyle>>;
    }) =>
      style ? (
        <Animated.View pointerEvents="none" style={[styles.overlay, style]} />
      ) : null,
  };

  componentDidMount() {
    if (!this.props.preloaded) {
      this.animate({
        closing: this.props.closing,
      });
    }
    this.isCurrentlyMounted = true;
  }

  componentDidUpdate(prevProps: Props) {
    const { direction, layout, gestureDirection, closing } = this.props;
    const { width, height } = layout;

    if (width !== prevProps.layout.width) {
      this.layout.width.setValue(width);
    }

    if (height !== prevProps.layout.height) {
      this.layout.height.setValue(height);
    }

    if (gestureDirection !== prevProps.gestureDirection) {
      this.inverted.setValue(
        getInvertedMultiplier(gestureDirection, direction === 'rtl')
      );
    }

    const toValue = this.getAnimateToValue(this.props);

    if (
      this.getAnimateToValue(prevProps) !== toValue ||
      this.lastToValue !== toValue
    ) {
      // We need to trigger the animation when route was closed
      // The route might have been closed by a `POP` action or by a gesture
      // When route was closed due to a gesture, the animation would've happened already
      // It's still important to trigger the animation so that `onClose` is called
      // If `onClose` is not called, cleanup step won't be performed for gestures
      this.animate({ closing });
    }
  }

  componentWillUnmount() {
    this.props.gesture?.stopAnimation();
    this.isCurrentlyMounted = false;
    this.handleEndInteraction();
  }

  private isCurrentlyMounted = false;

  private isClosing = new Animated.Value(FALSE);

  private inverted = new Animated.Value(
    getInvertedMultiplier(
      this.props.gestureDirection,
      this.props.direction === 'rtl'
    )
  );

  private layout = {
    width: new Animated.Value(this.props.layout.width),
    height: new Animated.Value(this.props.layout.height),
  };

  private isSwiping = new Animated.Value(FALSE);

  private interactionHandle: number | undefined;

  private pendingGestureCallback: number | undefined;

  private lastToValue: number | undefined;

  private animate = ({
    closing,
    velocity,
  }: {
    closing: boolean;
    velocity?: number;
  }) => {
    const { transitionSpec, onOpen, onClose, onTransition, gesture } =
      this.props;

    const toValue = this.getAnimateToValue({
      ...this.props,
      closing,
    });

    this.lastToValue = toValue;

    this.isClosing.setValue(closing ? TRUE : FALSE);

    const spec = closing ? transitionSpec.close : transitionSpec.open;

    const animation =
      spec.animation === 'spring' ? Animated.spring : Animated.timing;

    this.setPointerEventsEnabled(!closing);
    this.handleStartInteraction();

    clearTimeout(this.pendingGestureCallback);

    onTransition?.({ closing, gesture: velocity !== undefined });
    animation(gesture, {
      ...spec.config,
      velocity,
      toValue,
      useNativeDriver,
      isInteraction: false,
    }).start(({ finished }) => {
      this.handleEndInteraction();

      clearTimeout(this.pendingGestureCallback);

      if (finished) {
        if (closing) {
          onClose();
        } else {
          onOpen();
        }

        if (this.isCurrentlyMounted) {
          // Make sure to re-open screen if it wasn't removed
          this.forceUpdate();
        }
      }
    });
  };

  private getAnimateToValue = ({
    closing,
    layout,
    gestureDirection,
    direction,
    preloaded,
  }: {
    closing?: boolean;
    layout: Layout;
    gestureDirection: GestureDirection;
    direction: LocaleDirection;
    preloaded: boolean;
  }) => {
    if (!closing && !preloaded) {
      return 0;
    }

    return getDistanceForDirection(
      layout,
      gestureDirection,
      direction === 'rtl'
    );
  };

  private setPointerEventsEnabled = (enabled: boolean) => {
    const pointerEvents = enabled ? 'box-none' : 'none';

    this.ref.current?.setPointerEvents(pointerEvents);
  };

  private handleStartInteraction = () => {
    if (this.interactionHandle === undefined) {
      this.interactionHandle = InteractionManager.createInteractionHandle();
    }
  };

  private handleEndInteraction = () => {
    if (this.interactionHandle !== undefined) {
      InteractionManager.clearInteractionHandle(this.interactionHandle);
      this.interactionHandle = undefined;
    }
  };

  // Memoize this to avoid extra work on re-render
  private getInterpolatedStyle = memoize(
    (
      styleInterpolator: StackCardStyleInterpolator,
      animation: StackCardInterpolationProps
    ) => styleInterpolator(animation)
  );

  // Keep track of the animation context when deps changes.
  private getCardAnimation = memoize(
    (
      interpolationIndex: number,
      current: Animated.AnimatedInterpolation<number>,
      next: Animated.AnimatedInterpolation<number> | undefined,
      layout: Layout,
      insetTop: number,
      insetRight: number,
      insetBottom: number,
      insetLeft: number
    ) => ({
      index: interpolationIndex,
      current: { progress: current },
      next: next && { progress: next },
      closing: this.isClosing,
      swiping: this.isSwiping,
      inverted: this.inverted,
      layouts: {
        screen: layout,
      },
      insets: {
        top: insetTop,
        right: insetRight,
        bottom: insetBottom,
        left: insetLeft,
      },
    })
  );

  private ref = React.createRef<CardSheetRef>();

  render() {
    const {
      styleInterpolator,
      interpolationIndex,
      current,
      next,
      layout,
      insets,
      overlay,
      overlayEnabled,
      shadowEnabled,
      gestureDirection,
      pageOverflowEnabled,
      children,
      containerStyle: customContainerStyle,
      contentStyle,
      /* eslint-disable @typescript-eslint/no-unused-vars */
      closing,
      direction,
      gestureResponseDistance,
      gestureVelocityImpact,
      onClose,
      onGestureBegin,
      onGestureCanceled,
      onGestureEnd,
      onOpen,
      onTransition,
      transitionSpec,
      /* eslint-enable @typescript-eslint/no-unused-vars */
      ...rest
    } = this.props;

    const interpolationProps = this.getCardAnimation(
      interpolationIndex,
      current,
      next,
      layout,
      insets.top,
      insets.right,
      insets.bottom,
      insets.left
    );

    const interpolatedStyle = this.getInterpolatedStyle(
      styleInterpolator,
      interpolationProps
    );

    const { containerStyle, cardStyle, overlayStyle, shadowStyle } =
      interpolatedStyle;

    const { backgroundColor } = StyleSheet.flatten(contentStyle || {});
    const isTransparent =
      typeof backgroundColor === 'string'
        ? Color(backgroundColor).alpha() === 0
        : false;

    return (
      <CardAnimationContext.Provider value={interpolationProps}>
        <Animated.View
          style={{
            // This is a dummy style that doesn't actually change anything visually.
            // Animated needs the animated value to be used somewhere, otherwise things don't update properly.
            // If we disable animations and hide header, it could end up making the value unused.
            // So we have this dummy style that will always be used regardless of what else changed.
            opacity: current,
          }}
          // Make sure that this view isn't removed. If this view is removed, our style with animated value won't apply
          collapsable={false}
        />
        <View
          pointerEvents="box-none"
          // Make sure this view is not removed on the new architecture, as it causes focus loss during navigation on Android.
          // This can happen when the view flattening results in different trees - due to `overflow` style changing in a parent.
          collapsable={false}
          {...rest}
        >
          {overlayEnabled ? (
            <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
              {overlay({ style: overlayStyle })}
            </View>
          ) : null}
          <Animated.View
            style={[styles.container, containerStyle, customContainerStyle]}
            pointerEvents="box-none"
          >
            <Animated.View
              needsOffscreenAlphaCompositing={hasOpacityStyle(cardStyle)}
              style={[styles.container, cardStyle]}
            >
              {shadowEnabled && shadowStyle && !isTransparent ? (
                <Animated.View
                  style={[
                    styles.shadow,
                    gestureDirection === 'horizontal'
                      ? [styles.shadowHorizontal, styles.shadowStart]
                      : gestureDirection === 'horizontal-inverted'
                        ? [styles.shadowHorizontal, styles.shadowEnd]
                        : gestureDirection === 'vertical'
                          ? [styles.shadowVertical, styles.shadowTop]
                          : [styles.shadowVertical, styles.shadowBottom],
                    { backgroundColor },
                    shadowStyle,
                  ]}
                  pointerEvents="none"
                />
              ) : null}
              <CardSheet
                ref={this.ref}
                enabled={pageOverflowEnabled}
                layout={layout}
                style={contentStyle}
              >
                {children}
              </CardSheet>
            </Animated.View>
          </Animated.View>
        </View>
      </CardAnimationContext.Provider>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: '#000',
  },
  shadow: {
    position: 'absolute',
    shadowRadius: 5,
    shadowColor: '#000',
    shadowOpacity: 0.3,
  },
  shadowHorizontal: {
    top: 0,
    bottom: 0,
    width: 3,
    shadowOffset: { width: -1, height: 1 },
  },
  shadowStart: {
    start: 0,
  },
  shadowEnd: {
    end: 0,
  },
  shadowVertical: {
    start: 0,
    end: 0,
    height: 3,
    shadowOffset: { width: 1, height: -1 },
  },
  shadowTop: {
    top: 0,
  },
  shadowBottom: {
    bottom: 0,
  },
});
