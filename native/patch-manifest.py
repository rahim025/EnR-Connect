# Ajoute au manifeste Android : permissions, bulle, service de réception, réponse rapide.
p = 'android/app/src/main/AndroidManifest.xml'
s = open(p, encoding='utf-8').read()

composants = '''
        <activity
            android:name=".BubbleActivity"
            android:allowEmbedded="true"
            android:resizeableActivity="true"
            android:documentLaunchMode="always"
            android:exported="false"
            android:theme="@style/AppTheme.NoActionBar"
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode" />
        <service
            android:name=".WatcherService"
            android:exported="false"
            android:foregroundServiceType="specialUse">
            <property
                android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"
                android:value="Reception des messages du groupe" />
        </service>
        <receiver android:name=".ReplyReceiver" android:exported="false" />
'''
permissions = '''
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_SPECIAL_USE" />
'''
if 'WatcherService' not in s:
    s = s.replace('</application>', composants + '    </application>', 1)
    s = s.replace('</manifest>', permissions + '</manifest>', 1)
open(p, 'w', encoding='utf-8').write(s)
print(s)
