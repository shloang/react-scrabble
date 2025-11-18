import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle, AlertCircle } from "lucide-react";

interface ValidationMessageProps {
  message: string;
  isValidating: boolean;
  isError?: boolean;
}

export default function ValidationMessage({ message, isValidating, isError }: ValidationMessageProps) {
  if (!message && !isValidating) return null;

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-md px-4">
      <Alert 
        variant={isError ? "destructive" : "default"}
        className="shadow-lg"
        data-testid="validation-message"
      >
        {isError ? (
          <AlertCircle className="h-4 w-4" />
        ) : (
          <CheckCircle className="h-4 w-4" />
        )}
        <AlertDescription className="font-medium">
          {isValidating ? 'Проверка слов...' : message}
        </AlertDescription>
      </Alert>
    </div>
  );
}
