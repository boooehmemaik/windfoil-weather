// Bridges the UMD React global (set by vendor/react.production.min.js) to ESM.
// Required for auth-client.bundle.js, which marks react/react-dom as external.
// Must be listed in an importmap AFTER the UMD <script> tags so window.React is set.
const R = window.React;
export default R;
export const {
  useState, useEffect, useReducer, useRef, useCallback, useMemo,
  useContext, useLayoutEffect, useId, useTransition, useDeferredValue,
  useSyncExternalStore, useInsertionEffect, useDebugValue,
  createContext, createRef, forwardRef, memo, lazy, Suspense,
  Fragment, StrictMode, Children, Component, PureComponent,
  cloneElement, createElement, isValidElement, version,
} = R;
