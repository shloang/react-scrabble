import React from "react";
import { useLocation } from "wouter";

type Props = {
  children?: React.ReactNode;
};

type State = {
  hasError: boolean;
};

function NavigateButton() {
  const [, setLocation] = useLocation();
  return (
    <button
      onClick={() => setLocation('/lobby')}
      className="mt-4 px-4 py-2 rounded bg-blue-600 text-white"
    >
      Вернуться в лобби
    </button>
  );
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, info);
    this.setState({ hasError: true });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6">
          <div>Произошла ошибка отображения игры — возвращаем в лобби</div>
          <NavigateButton />
        </div>
      );
    }

    return this.props.children as React.ReactElement;
  }
}
