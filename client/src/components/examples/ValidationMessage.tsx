import ValidationMessage from '../ValidationMessage';

export default function ValidationMessageExample() {
  return (
    <div className="p-8 bg-background space-y-4">
      <ValidationMessage
        message="Валидные слова: СЛОВО, ИГРА"
        isValidating={false}
        isError={false}
      />
      <ValidationMessage
        message="Недопустимые слова: АБВГД"
        isValidating={false}
        isError={true}
      />
      <ValidationMessage
        message=""
        isValidating={true}
        isError={false}
      />
    </div>
  );
}
