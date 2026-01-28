import 'package:flutter_test/flutter_test.dart';
import 'package:craft_app/core/di/service_locator.dart';
import 'package:craft_app/main.dart';

void main() {
  testWidgets('App smoke test', (WidgetTester tester) async {
    ServiceLocator.init();
    await tester.pumpWidget(const MyApp());
    expect(find.byType(MyApp), findsOneWidget);
  });
}
