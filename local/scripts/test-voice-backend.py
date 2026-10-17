"""Pure phonetic/context regression: loads only AST-selected code, never models or dependencies."""
import ast
from pathlib import Path
import re
import unittest

source = Path(__file__).resolve().parents[1] / 'atc_ai_server.py'
tree = ast.parse(source.read_text())
constants = {'ICAO_NATO_MAP', 'ICAO_DIGIT_EN', 'CN_AIRLINE_MAP'}
functions = {'format_kokoro_aviation_phonetics', 'verify_sensevoice_with_airspace_context'}
nodes = [node for node in tree.body if
         (isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id in constants for target in node.targets)) or
         (isinstance(node, ast.FunctionDef) and node.name in functions)]
namespace = {'re': re, 'List': list}
exec(compile(ast.Module(body=nodes, type_ignores=[]), str(source), 'exec'), namespace)
format_speech = namespace['format_kokoro_aviation_phonetics']

class VoiceBackendTests(unittest.TestCase):
    def test_unspaced_chinese_runway_and_frequency(self):
        result = format_speech('下降并保持600米，可以跑道09L盲降进近，脱离后联系121.9，东方航空5213。', 'zh-CN')
        self.assertIn('洞九左', result)
        self.assertIn('幺两幺点九', result)
        self.assertTrue(result.endswith('东方航空 五两幺三。'))
        self.assertNotIn('09L', result)

    def test_chinese_no_english_abbreviation_after_chinese_words(self):
        result = format_speech('可以ILS盲降，RWY09L，东方航空5213。', 'zh-CN')
        self.assertNotIn('ILS', result)
        self.assertNotIn('RWY', result)
        self.assertIn('洞九左', result)

    def test_english_instruction_then_callsign_survives_phonetic_conversion(self):
        result = format_speech('DESCEND AND MAINTAIN 600 METERS, CLEARED ILS RWY 09L APPROACH, CHINA EASTERN 5213.')
        self.assertIn('six hundred meters', result)
        self.assertIn('I L S runway zero niner left', result)
        self.assertTrue(result.endswith('CHINA EASTERN five two one three.'))
        self.assertNotIn('5213', result)

    def test_context_does_not_replace_explicit_unknown_callsign(self):
        verify = namespace['verify_sensevoice_with_airspace_context']
        result = verify('CES9999下600', 'CES9999下600', ['CES5213'], [], ['09L', '09R'])
        self.assertIn('CES9999', result)
        self.assertNotIn('CES5213', result)

if __name__ == '__main__':
    unittest.main()
