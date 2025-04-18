import pandas as pd

# Excel 文件路径，根据实际情况调整
file_path = "Meme_Token_Rating_Model_V0 1.xlsx"

# 读取 Excel 文件中的所有工作表
sheets = pd.read_excel(file_path, sheet_name=None)

# 用于存放 Markdown 文本
markdown_output = ""
for sheet_name, df in sheets.items():
    markdown_output += f"## 工作表：{sheet_name}\n\n"
    markdown_table = df.to_markdown(index=False)
    markdown_output += markdown_table + "\n\n"

# 将结果保存为一个 Markdown 文件
with open("converted_markdown.md", "w", encoding="utf-8") as f:
    f.write(markdown_output)

print("转换完成，Markdown 文件保存为 converted_markdown.md")
