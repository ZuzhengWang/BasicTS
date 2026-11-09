#!/usr/bin/env python3
"""Build the binary AndroidManifest.xml for the offline shell. usage: make_manifest.py out.xml versionCode versionName"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import axml

A = True  # android namespace marker
out, vcode, vname = sys.argv[1], int(sys.argv[2]), sys.argv[3]
ICON = 0x7f0a0000        # launcher icon from the original APK's resources.arsc
THEME = 0x7f0d000a       # activity theme from the original APK's resources.arsc

tree = ('manifest', [
    (A, 'versionCode', 0x0101021b, vcode),
    (A, 'versionName', 0x0101021c, vname),
    (None, 'package', 0, 'com.molehero.offline'),
], [
    ('uses-sdk', [(A, 'minSdkVersion', 0x0101020c, 24), (A, 'targetSdkVersion', 0x01010270, 34)], []),
    ('uses-permission', [(A, 'name', 0x01010003, 'android.permission.INTERNET')], []),
    ('application', [
        (A, 'label', 0x01010001, '摩尔勇士离线版'),
        (A, 'name', 0x01010003, 'com.molehero.offline.MoleApp'),
        (A, 'icon', 0x01010002, ('ref', ICON)),
        (A, 'allowBackup', 0x01010280, False),
        (A, 'hardwareAccelerated', 0x010102d3, True),
        (A, 'largeHeap', 0x0101035a, True),
        (A, 'usesCleartextTraffic', 0x010104ec, False),
    ], [
        ('activity', [
            (A, 'name', 0x01010003, 'com.molehero.offline.MainActivity'),
            (A, 'theme', 0x01010000, ('ref', THEME)),
            (A, 'label', 0x01010001, '摩尔勇士离线版'),
            (A, 'exported', 0x01010010, True),
            (A, 'launchMode', 0x0101001d, 2),
            (A, 'screenOrientation', 0x0101001e, 6),
            (A, 'configChanges', 0x0101001f, ('hex', 0x40001ff0)),
            (A, 'windowSoftInputMode', 0x0101022b, ('hex', 0x20)),
        ], [
            ('intent-filter', [], [
                ('action', [(A, 'name', 0x01010003, 'android.intent.action.MAIN')], []),
                ('category', [(A, 'name', 0x01010003, 'android.intent.category.LAUNCHER')], []),
            ]),
        ]),
    ]),
])
data = axml.encode(tree)
open(out, 'wb').write(data)
print(axml.dump(data))
