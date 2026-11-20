"""Build CoupleCAM's two scene graphs from a local SmolVLM-256M-Instruct checkout.

Usage: python export_scene_vlm.py MODEL_DIRECTORY OUTPUT_DIRECTORY
Requires numpy, tokenizers, onnx and onnxruntime.
"""
import argparse
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
from onnx import TensorProto, helper, numpy_helper
from tokenizers import Tokenizer


CATEGORIES = [
    "couple man woman person child group boy girl portrait",
    "forest wooded tree garden park woodland",
    "street building city village town tower bridge alley castle temple church",
    "beach lake river ocean waterfall coast shoreline",
    "mountain mountainous valley cliff peak glacier",
    "room living bedroom kitchen bathroom couch interior office",
    "dog cat animal bird flower car plate phone screen meal painting cartoon toy computer table book bowl blank bottle",
]


def export(source, output):
    graphs = source / "onnx"
    tokenizer = Tokenizer.from_file(str(source / "tokenizer.json"))
    def encode(text):
        return tokenizer.encode(text, add_special_tokens=False).ids

    word_ids, groups = [], []
    for category in CATEGORIES:
        start = len(word_ids)
        for word in category.split():
            ids = encode(" " + word)
            if len(ids) == 1:
                word_ids.extend(ids)
        groups.append(list(range(start, len(word_ids))))

    prompt = ("<|im_start|>User:<fake_token_around_image><global-img>" + "<image>" * 64 +
              "<fake_token_around_image>What is in this photo? Answer briefly.<end_of_utterance>\n"
              "Assistant: The image shows a")
    ids = encode(prompt)
    image_start = ids.index(49190)
    assert ids[image_start:image_start+64] == [49190]*64
    embeddings = ort.InferenceSession(str(graphs / "embed_tokens_int8.onnx"), providers=["CPUExecutionProvider"])
    text = embeddings.run(None, {"input_ids": np.array([ids], np.int64)})[0]
    model = onnx.load(graphs / "decoder_model_merged_q4.onnx")
    graph = model.graph

    def constant(name, values):
        graph.initializer.append(numpy_helper.from_array(np.asarray(values), name))

    constant("prefix", text[:, :image_start])
    constant("suffix", text[:, image_start+64:])
    constant("attention_mask", np.ones((1, len(ids)), np.int64))
    constant("position_ids", np.arange(1, len(ids)+1, dtype=np.int64)[None])
    constant("last", np.array([-1], np.int64))
    for inp in graph.input:
        if inp.name.startswith("past_key_values"):
            constant(inp.name, np.zeros((1,3,0,64), np.float32))
    del graph.input[:]
    graph.input.append(helper.make_tensor_value_info("image_features", TensorProto.FLOAT, [1,64,576]))
    graph.node.insert(0, helper.make_node("Concat", ["prefix","image_features","suffix"], ["inputs_embeds"], axis=1))

    # Evaluate only the last position and the selected vocabulary rows of the original head.
    head = graph.node[-1]
    hidden = head.input[0]
    head.input[0] = "last_hidden"
    for attr in head.attribute:
        if attr.name == "N":
            attr.i = len(word_ids)
    for tensor in graph.initializer:
        if tensor.name in list(head.input)[1:]:
            raw = numpy_helper.to_array(tensor)
            subset = raw.reshape(49280, -1)[word_ids]
            shape = (-1,) if raw.ndim == 1 else (len(word_ids), *raw.shape[1:])
            tensor.CopyFrom(numpy_helper.from_array(subset.reshape(shape), tensor.name))
    graph.node.insert(len(graph.node)-1, helper.make_node("Gather", [hidden, "last"], ["last_hidden"], axis=1))
    scores = []
    for i, indices in enumerate(groups):
        group, words, score = f"group{i}", f"words{i}", f"score{i}"
        constant(group, np.array(indices, np.int64))
        graph.node.append(helper.make_node("Gather", ["logits",group], [words], axis=2))
        graph.node.append(helper.make_node("ReduceMax", [words], [score], axes=[2], keepdims=1))
        scores.append(score)
    graph.node.append(helper.make_node("Concat", scores, ["scene_scores"], axis=2))
    del graph.output[:]
    graph.output.append(helper.make_tensor_value_info("scene_scores", TensorProto.FLOAT, [1,1,len(groups)]))
    del graph.value_info[:]
    output.mkdir(parents=True, exist_ok=True)
    onnx.save(model, output / "scene.onnx")

    vision = onnx.load(graphs / "vision_encoder_q4.onnx")
    vision.graph.initializer.append(numpy_helper.from_array(np.ones((1,1,512,512), bool), "pixel_attention_mask"))
    del vision.graph.input[1:]
    onnx.save(vision, output / "vision.onnx")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    export(args.source, args.output)
